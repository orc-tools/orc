"""The ``<orc-context>`` block Orc puts ahead of a turn's text.

A turn whose agent has no system prompt or hooks for Orc carries Orc's
context in one leading block instead, which Chat leaves out of the person's
message.
"""
import re

CONTEXT = re.compile(r"\A<orc-context>\n.*?\n</orc-context>\n\n", re.S)


def wrap(context, text):
    return "<orc-context>\n%s\n</orc-context>\n\n%s" % (context.strip(), text) if context else text


def strip(text):
    return CONTEXT.sub("", text, count=1) if isinstance(text, str) else text
