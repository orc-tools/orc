"""Provider usage routes and saved per-account settings."""
import json
from urllib.parse import parse_qs

import provider_usage


# Weekly windows the viewer left out of the sidebar usage bar, as
# "<account>|<label>" keys. They live with the host so every device that
# opens it shows the same bar.
USAGE_EXCLUDED_WINDOWS_MAX = 100


def plan_renewal_days(config):
    """Plan renewal days set by hand in Settings, keyed by usage account."""
    ui = config.get("ui") if isinstance(config.get("ui"), dict) else {}
    days = ui.get("planRenewalDays")
    return days if isinstance(days, dict) else {}


def usage_excluded_windows(config):
    """Usage windows left out of the sidebar bar, keyed "<account>|<label>",
    or None until this host has saved a choice."""
    ui = config.get("ui") if isinstance(config.get("ui"), dict) else {}
    saved = ui.get("usageExcludedWindows")
    return [key for key in saved if isinstance(key, str)] if isinstance(saved, list) else None


class Service:
    def __init__(self, *, read_config, config_guard, write_config, plugin_usage, name_usage,
                 auto_reset, preview, may_mutate):
        self.read_config = read_config
        self.config_guard = config_guard
        self.write_config = write_config
        self.plugin_usage = plugin_usage
        self.name_usage = name_usage
        self.auto_reset = auto_reset
        self.preview = preview
        self.may_mutate = may_mutate

    def save_plan_renewal_day(self, account, day):
        """Save or clear (None) one account's manual renewal day in config.json,
        keeping every other key."""
        if not isinstance(account, str) or account not in provider_usage.account_keys():
            raise ValueError("Unknown account.")
        if day is not None and not provider_usage.valid_renewal_day(day):
            raise ValueError("Enter a day of the month from 1 to 31.")
        with self.config_guard():
            config, _, error = self.read_config()
            if error:
                raise OSError("config.json could not be read")
            saved = plan_renewal_days(config)
            days = {key: value for key, value in saved.items() if key != account}
            if day is not None:
                days[account] = day
            if days != saved:
                ui = config.get("ui") if isinstance(config.get("ui"), dict) else {}
                _, error = self.write_config({**config, "ui": {**ui, "planRenewalDays": days}})
                if error:
                    raise OSError(error)
            return days

    def save_usage_excluded_window(self, account, label, excluded):
        """Leave one account's model-specific weekly window out of the sidebar bar
        (excluded=True) or count it again, keeping every other config key."""
        if not isinstance(account, str) or account not in provider_usage.account_keys():
            raise ValueError("Unknown account.")
        if (not isinstance(label, str) or len(label) > 80 or "|" in label
                or not (label.startswith("Weekly · ") or label.endswith(" · Weekly"))):
            raise ValueError("Only a model's own weekly window can be left out.")
        if not isinstance(excluded, bool):
            raise ValueError("Send excluded as true or false.")
        key = f"{account}|{label}"
        with self.config_guard():
            config, _, error = self.read_config()
            if error:
                raise OSError("config.json could not be read")
            saved = usage_excluded_windows(config) or []
            result = [entry for entry in saved if entry != key] + ([key] if excluded else [])
            result = result[-USAGE_EXCLUDED_WINDOWS_MAX:]
            ui = config.get("ui") if isinstance(config.get("ui"), dict) else {}
            if result != ui.get("usageExcludedWindows"):
                _, error = self.write_config({**config, "ui": {**ui, "usageExcludedWindows": result}})
                if error:
                    raise OSError(error)
            return result

    def post_codex_auto_reset(self, handler):
        reset = self.auto_reset()
        if reset is None:
            return handler.json_error(409, "Auto-reset is available on your Orc host.")
        data = handler.read_json_object(1024)
        if (data is None or set(data) != {"account", "enabled"}
                or not isinstance(data["account"], str) or not isinstance(data["enabled"], bool)):
            return handler.json_error(400, "Send a Codex account and whether to enable auto-reset.")
        try:
            status = reset.set_enabled(data["account"], data["enabled"])
        except ValueError as error:
            return handler.json_error(409, str(error))
        except OSError:
            return handler.json_error(500, "Could not save Codex auto-reset.")
        return handler.send_body(json.dumps({"codexAutoReset": status}).encode(), "application/json")

    def post_provider_reset(self, handler):
        if self.preview():
            return handler.json_error(409, "Reset redemption is disabled in previews.")
        data = handler.read_json_object(1024)
        if data is None or data.get('confirmed') is not True:
            return handler.json_error(400, "Confirm spending one Codex usage limit reset.")
        try:
            result = provider_usage.redeem_reset(data.get('idempotencyKey'))
        except ValueError as error:
            return handler.json_error(400, str(error))
        except provider_usage.ProbeError as error:
            return handler.json_error(502, str(error))
        return handler.send_body(json.dumps(result).encode(), "application/json")

    def post_plan_renewal_day(self, handler):
        data = handler.read_json_object(1024)
        if data is None or set(data) != {"account", "day"}:
            return handler.json_error(400, "Send an account and a day of the month.")
        account, day = data["account"], data["day"]
        try:
            days = self.save_plan_renewal_day(account, day)
        except ValueError as error:
            return handler.json_error(400, str(error))
        except OSError as error:
            return handler.json_error(500, str(error))
        provider, _, name = account.partition(":")
        return handler.send_body(json.dumps({"account": account, "renewal": provider_usage.renewal(
            provider, name or None, days)}).encode(), "application/json")

    def post_usage_excluded_window(self, handler):
        data = handler.read_json_object(1024)
        if data is None or set(data) != {"account", "label", "excluded"}:
            return handler.json_error(400, "Send an account, a window label and excluded.")
        try:
            saved = self.save_usage_excluded_window(data["account"], data["label"], data["excluded"])
        except ValueError as error:
            return handler.json_error(400, str(error))
        except OSError as error:
            return handler.json_error(500, str(error))
        return handler.send_body(json.dumps({"excludedWindows": saved}).encode(), "application/json")

    def get(self, handler, path):
        if path != "/api/provider-usage":
            return False
        query = parse_qs(handler.path.partition("?")[2])
        config = self.read_config()[0]
        # Asked per request, not from the runtime's context, so a server
        # whose runs folder moved after start never asks plugins to go online.
        usage = provider_usage.snapshot(refresh=query.get("refresh") == ["1"],
                                        renewal_days=plan_renewal_days(config),
                                        plugin_usage=self.plugin_usage())
        self.name_usage(usage["providers"])
        reset = self.auto_reset()
        usage = {**usage, "excludedWindows": usage_excluded_windows(config),
                 "codexAutoReset": reset.status() if reset else None}
        handler.send_body(json.dumps(usage).encode(), "application/json")
        return True

    def post(self, handler, path):
        action = self.POST.get(path)
        if action is None:
            return False
        if not self.may_mutate(handler.headers):
            handler.json_error(403, "cross-site POST rejected")
        else:
            action(self, handler)
        return True

    POST = {
        "/api/provider-usage/auto-reset": post_codex_auto_reset,
        "/api/provider-usage/redeem-reset": post_provider_reset,
        "/api/provider-usage/renewal-day": post_plan_renewal_day,
        "/api/provider-usage/excluded-window": post_usage_excluded_window,
    }
