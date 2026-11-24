"""Orc usage stats. Validated events wait in a small in-memory buffer that a
background thread uploads to the user's Orc Worker (cloud/project-memory),
and the Activity Usage tab reads the combined counts of every installation
that shares the Worker's token back from it. Nothing is written to disk: an
unconfigured, offline or failed upload drops its events."""
import collections
import datetime
import math
import re
import secrets
import subprocess
import threading
import time

import keychain_secrets
import cloud_worker

RANGES = ('7d', '30d', 'quarter', '1y', 'all')
DAY_BUCKET_MAX_DAYS = 92
WEEK_BUCKET_MAX_DAYS = 400
MONTHS = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')
ANSI = re.compile(r'\u001b?\[[0-9;]*m\]?')
CLIENTS = frozenset({'app', 'browser', 'pwa', 'lan', 'server', 'discord'})
EVENT_NAME = re.compile(r'[a-z][a-z0-9_.-]{0,63}')
PROP_KEY = re.compile(r'[A-Za-z][A-Za-z0-9_]{0,31}')
CONTROL = re.compile(r'[\x00-\x1f\x7f-\x9f]')
FEATURE_MAX = 120
VIEW_MAX = 80
PROP_VALUE_MAX = 120
MAX_PROPS = 12
PAST_MS = 7 * 24 * 3600 * 1000
FUTURE_MS = 5 * 60 * 1000
# The buffer is the only copy of an event before upload; past this the
# oldest go first.
BUFFER_MAX = 200
UPLOAD_AT = 50
UPLOAD_AFTER = 15
UPLOAD_BATCH = 100
UPLOAD_TIMEOUT = 10
SUMMARY_TIMEOUT = 10
CACHE_SECONDS = 60
DIMENSIONS = {'feature': 'features', 'view': 'views', 'model': 'models',
              'effort': 'efforts', 'agent': 'agents'}
NOT_CONFIGURED = 'Usage stats come from your Orc Worker, which is not set up on this Mac. ' + cloud_worker.NOT_CONFIGURED
SWITCHED_OFF = 'Usage stats are off on this server because it uses a test or preview run store.'

_LOCK = threading.Lock()
_WAKE = threading.Condition(_LOCK)
_BUFFER = collections.deque(maxlen=BUFFER_MAX)
_UPLOADER = None
_CACHE_LOCK = threading.Lock()
_SUMMARIES = {}
_clock = time.monotonic


class UsageUnavailable(RuntimeError):
    """The Worker cannot answer a summary; the message is for the reader."""


def now_ms():
    return int(time.time() * 1000)


def clean_text(value, limit):
    if not isinstance(value, str):
        return None
    return ' '.join(CONTROL.sub(' ', value).split())[:limit].rstrip() or None


def clean_props(props):
    kept = {}
    if not isinstance(props, dict):
        return kept
    for key, value in props.items():
        if len(kept) == MAX_PROPS:
            break
        if not isinstance(key, str) or not PROP_KEY.fullmatch(key):
            continue
        if isinstance(value, str):
            kept[key] = value[:PROP_VALUE_MAX]
        elif value is None or isinstance(value, bool) \
                or isinstance(value, (int, float)) and math.isfinite(value):
            kept[key] = value
    return kept


def clean_event(raw, now):
    """The kept form of one client event, or None when it must be dropped."""
    if not isinstance(raw, dict):
        return None
    name, feature = raw.get('event'), clean_text(raw.get('feature'), FEATURE_MAX)
    if not isinstance(name, str) or not EVENT_NAME.fullmatch(name) or not feature:
        return None
    ts = raw.get('ts')
    if type(ts) is not int or not now - PAST_MS <= ts <= now + FUTURE_MS:
        ts = now
    event = {'ts': ts, 'event': name, 'feature': feature}
    view = clean_text(raw.get('view'), VIEW_MAX)
    if view:
        event['view'] = view
    if raw.get('client') in CLIENTS:
        event['client'] = raw['client']
    props = clean_props(raw.get('props'))
    if props:
        event['props'] = props
    return event


def launch_label(value):
    if not isinstance(value, str):
        return None
    return ANSI.sub('', value).strip().lower() or None


def upload_form(event, event_id=None):
    """The Worker's form of one clean event: an ID, its local day, no run ID,
    and a launch's model, effort and agent as the Usage tab names them."""
    props = {key: value for key, value in (event.get('props') or {}).items() if key != 'runId'}
    if event['event'] == 'run.launch':
        launch = {'model': launch_label(props.get('model')) or 'default',
                  'effort': launch_label(props.get('effort')) or 'default',
                  'agent': launch_label(props.get('agent'))}
        rest = [(key, value) for key, value in props.items() if key not in launch]
        props = dict((list(launch.items()) + rest)[:MAX_PROPS])
    return {'id': event_id or secrets.token_hex(16), 'ts': event['ts'],
            'day': datetime.date.fromtimestamp(event['ts'] / 1000).isoformat(),
            'event': event['event'], 'feature': event['feature'],
            'view': event.get('view'), 'client': event.get('client'), 'props': props}


def record(config_dir, raw_events, now=None):
    """Queue every valid event in `raw_events` for upload; returns (accepted,
    dropped). With no Worker configured the events are counted and dropped."""
    now = now_ms() if now is None else now
    events = [event for event in (clean_event(raw, now) for raw in raw_events) if event]
    try:
        if events and config_dir is not None and cloud_worker.url(config_dir):
            queued = [upload_form(event) for event in events]
            with _WAKE:
                _BUFFER.extend(queued)
                _WAKE.notify()
            _wake(config_dir)
    except Exception:  # noqa: BLE001 - usage stats never fail the caller
        pass
    return len(events), len(raw_events) - len(events)


def flush(config_dir, *, call=cloud_worker.request, keychain=keychain_secrets):
    """Send up to one batch of queued events. A batch that cannot be sent is
    dropped: usage stats never retry and never block Orc."""
    with _LOCK:
        batch = [_BUFFER.popleft() for _ in range(min(len(_BUFFER), UPLOAD_BATCH))]
    if not batch:
        return None
    try:
        base, token = cloud_worker.credentials(config_dir, keychain)
        if not base:
            return None
        return call(base, token, 'POST', '/v1/usage/events', {'events': batch}, UPLOAD_TIMEOUT)
    except Exception:  # noqa: BLE001 - any failure only loses this batch
        return None


def _upload_loop(config_dir):
    while True:
        with _WAKE:
            while not _BUFFER:
                _WAKE.wait()
            deadline = time.monotonic() + UPLOAD_AFTER
            while len(_BUFFER) < UPLOAD_AT and time.monotonic() < deadline:
                _WAKE.wait(deadline - time.monotonic())
        flush(config_dir)


def _wake(config_dir):
    """Start the uploader thread the first time an event is queued."""
    global _UPLOADER
    with _LOCK:
        if _UPLOADER is not None:
            return
        _UPLOADER = threading.Thread(target=_upload_loop, args=(config_dir,),
                                     name='orc-usage-upload', daemon=True)
    try:
        _UPLOADER.start()
    except RuntimeError:
        with _LOCK:
            _UPLOADER = None


def _range_start(range_key, today, first_day):
    if range_key == '7d':
        return today - datetime.timedelta(days=7)
    if range_key == '30d':
        return today - datetime.timedelta(days=30)
    if range_key == 'quarter':
        return today.replace(month=(today.month - 1) // 3 * 3 + 1, day=1)
    if range_key == '1y':
        try:
            return today.replace(year=today.year - 1)
        except ValueError:
            # 29 Feb: the client's Date.setFullYear rolls over to 1 Mar.
            return today.replace(year=today.year - 1, month=3, day=1)
    return min(first_day, today) if first_day else today


def _buckets(start, end):
    """(granularity, buckets, {day ordinal: bucket index}) covering start..end."""
    span = (end - start).days
    days = [start + datetime.timedelta(days=offset) for offset in range(span + 1)]
    if span <= DAY_BUCKET_MAX_DAYS:
        kind, keys = 'day', [(day.isoformat(), '%d %s' % (day.day, MONTHS[day.month - 1]))
                             for day in days]
        index = list(range(len(days)))
    elif span <= WEEK_BUCKET_MAX_DAYS:
        kind, keys, index = 'week', [], []
        for day in days:
            monday = day - datetime.timedelta(days=day.weekday())
            if not keys or keys[-1][0] != monday.isoformat():
                keys.append((monday.isoformat(), 'w/c %d %s' % (monday.day, MONTHS[monday.month - 1])))
            index.append(len(keys) - 1)
    else:
        kind, keys, index = 'month', [], []
        for day in days:
            if not keys or keys[-1][0] != day.strftime('%Y-%m'):
                keys.append((day.strftime('%Y-%m'), '%s %d' % (MONTHS[day.month - 1], day.year)))
            index.append(len(keys) - 1)
    return (kind, [{'key': key, 'label': label} for key, label in keys],
            {day.toordinal(): position for day, position in zip(days, index)})


class _Dimension:
    def __init__(self, width):
        self.width = width
        self.names = {}

    def add(self, name, ts, bucket, count=1):
        entry = self.names.get(name)
        if entry is None:
            entry = self.names[name] = [0, [0] * self.width, ts]
        elif ts > entry[2]:
            entry[2] = ts
        if bucket is not None:
            entry[0] += count
            entry[1][bucket] += count

    def rows(self):
        return [{'name': name, 'count': count, 'series': series, 'lastUsedAt': last}
                for name, (count, series, last)
                in sorted(self.names.items(), key=lambda item: (-item[1][0], item[0]))]


def _fetch(config_dir, start, call, keychain):
    if config_dir is None:
        raise UsageUnavailable(SWITCHED_OFF)
    base = cloud_worker.url(config_dir)
    if not base:
        raise UsageUnavailable(NOT_CONFIGURED)
    try:
        base, token = cloud_worker.credentials(config_dir, keychain)
    except cloud_worker.WorkerError as exc:
        raise UsageUnavailable('%s Usage stats cannot be read without it.' % exc) from exc
    except keychain_secrets.SecretError as exc:
        raise UsageUnavailable(str(exc)) from exc
    except (OSError, subprocess.SubprocessError) as exc:
        raise UsageUnavailable('The Keychain is unavailable.') from exc
    try:
        return call(base, token, 'GET', '/v1/usage/summary?from=' + start, None, SUMMARY_TIMEOUT)
    except cloud_worker.WorkerError as exc:
        raise UsageUnavailable(str(exc)) from exc


def _payload(range_key, today, answer):
    first_day = answer['firstDay']
    start = _range_start(range_key, today, first_day and datetime.date.fromisoformat(first_day))
    granularity, buckets, bucket_of = _buckets(start, today)
    width = len(buckets)
    dimensions = {kind: _Dimension(width) for kind in DIMENSIONS}
    first_event = None
    for row in answer['names']:
        if row['kind'] not in dimensions:
            continue
        dimensions[row['kind']].add(row['name'], row['last'], None)
        if row['kind'] in ('feature', 'view'):
            first_event = row['first'] if first_event is None else min(first_event, row['first'])
    series = [0] * width
    active = set()
    launches = 0
    for row in answer['daily']:
        if row['kind'] not in dimensions:
            continue
        day = datetime.date.fromisoformat(row['day']).toordinal()
        bucket, count = bucket_of.get(day), int(row['count'])
        dimensions[row['kind']].add(row['name'], row['last'], bucket, count)
        if bucket is None or not count:
            continue
        if row['kind'] in ('feature', 'view'):
            series[bucket] += count
            active.add(day)
        elif row['kind'] == 'model':
            launches += count
    rows = {name: dimensions[kind].rows() for kind, name in DIMENSIONS.items()}
    return {
        'range': range_key, 'from': start.isoformat(), 'to': today.isoformat(),
        'bucket': granularity, 'buckets': buckets,
        'firstEventAt': first_event,
        'totals': {'events': sum(series), 'activeDays': len(active),
                   'features': sum(1 for row in rows['features'] if row['count']),
                   'launches': launches},
        'series': series,
        'dimensions': rows,
    }


def summary(config_dir, range_key='7d', now=None, *, call=cloud_worker.request,
            keychain=keychain_secrets, answer=None):
    """The Usage tab payload for `range_key`, bucketed in server local time,
    from every installation's events on the Worker. Raises UsageUnavailable
    when the Worker cannot answer. `answer` stands in for the Worker's, for a
    demo that has no Worker to ask."""
    if range_key not in RANGES:
        raise ValueError('unknown range')
    today = (now or datetime.datetime.now()).date()
    key = (str(config_dir), range_key, today.isoformat())
    with _CACHE_LOCK:
        cached = _SUMMARIES.get(key)
    if cached and _clock() - cached[0] < CACHE_SECONDS:
        return cached[1]
    asked = datetime.date(1970, 1, 1) if range_key == 'all' else _range_start(range_key, today, None)
    if answer is None:
        answer = _fetch(config_dir, asked.isoformat(), call, keychain)
    try:
        payload = _payload(range_key, today, answer)
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise UsageUnavailable('The usage Worker sent an unreadable answer.') from exc
    with _CACHE_LOCK:
        _SUMMARIES[key] = (_clock(), payload)
    return payload
