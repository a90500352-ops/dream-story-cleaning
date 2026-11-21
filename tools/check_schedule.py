#!/usr/bin/env python3
"""data/schedule.json 검사 + 다음 청소 요약.

사용법:
    python3 work/dream-story-cleaning/tools/check_schedule.py
    python3 work/dream-story-cleaning/tools/check_schedule.py --date 2026-11-25

일정을 고친 뒤 이 스크립트를 돌리면 날짜 오류·겹치는 예약·인원 누락을 잡아 줍니다.
오류가 있으면 종료 코드 1.
"""
import argparse
import datetime
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "schedule.json"
DOW = ["일", "월", "화", "수", "목", "금", "토"]

errors, warnings = [], []


def d(s):
    return datetime.date.fromisoformat(s)


def minutes(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def hhmm(mins):
    return "%02d:%02d" % (mins // 60, mins % 60)


def duration(start, end):
    m = minutes(end) - minutes(start)
    if m <= 0:
        return ""
    h, mm = divmod(m, 60)
    return ("%d시간 %d분" % (h, mm)) if mm else ("%d시간" % h)


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="기준 날짜 (YYYY-MM-DD, 기본: 오늘)")
    args = ap.parse_args()

    if not DATA_PATH.exists():
        print("데이터 파일이 없습니다:", DATA_PATH)
        return 1

    try:
        data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print("JSON 형식 오류:", e)
        return 1

    meta = data.get("meta") or {}
    pin = str(meta.get("pin") or "")
    if len(pin) != 4 or not pin.isdigit():
        err("meta.pin 은 숫자 4자리여야 합니다 (현재: %r)" % pin)
    try:
        datetime.datetime.fromisoformat(meta.get("last_updated", ""))
    except ValueError:
        err("meta.last_updated 가 ISO 날짜·시각 형식이 아닙니다: %r" % meta.get("last_updated"))

    base = meta.get("default_window") or {}
    for k in ("start", "end"):
        try:
            minutes(base.get(k, ""))
        except Exception:
            err("meta.default_window.%s 가 HH:MM 형식이 아닙니다: %r" % (k, base.get(k)))

    stays = data.get("stays") or []
    if not stays:
        err("stays 가 비어 있습니다")

    seen_ids = set()
    for i, s in enumerate(stays):
        tag = "stays[%d] %s" % (i, s.get("guest", "?"))
        if not s.get("guest"):
            err("%s: guest 없음" % tag)
        if not s.get("checkin"):
            err("%s: checkin 없음" % tag)
            continue
        try:
            ci = d(s["checkin"])
        except ValueError:
            err("%s: checkin 날짜 형식 오류 %r" % (tag, s.get("checkin")))
            continue
        co = None
        if s.get("checkout"):
            try:
                co = d(s["checkout"])
            except ValueError:
                err("%s: checkout 날짜 형식 오류 %r" % (tag, s.get("checkout")))
            if co and co <= ci:
                err("%s: checkout(%s)이 checkin(%s)보다 빠릅니다" % (tag, co, ci))
            if co and s.get("nights") is not None:
                real = (co - ci).days
                if real != s["nights"]:
                    warn("%s: nights=%s 이지만 실제 %d박입니다" % (tag, s["nights"], real))
        for f in ("adults", "children", "infants"):
            if s.get(f) is not None and (not isinstance(s[f], int) or s[f] < 0):
                err("%s: %s 값이 올바르지 않습니다: %r" % (tag, f, s[f]))
        if s.get("early_checkin"):
            try:
                minutes(s["early_checkin"])
            except Exception:
                err("%s: early_checkin 이 HH:MM 형식이 아닙니다: %r" % (tag, s["early_checkin"]))
        if s.get("id"):
            if s["id"] in seen_ids:
                err("%s: 예약번호 중복 %s" % (tag, s["id"]))
            seen_ids.add(s["id"])

    # 겹치는 예약 (한 채 독채이므로 겹치면 오류)
    ordered = sorted([s for s in stays if s.get("checkin") and s.get("checkout")],
                     key=lambda s: s["checkin"])
    for a, b in zip(ordered, ordered[1:]):
        if d(b["checkin"]) < d(a["checkout"]):
            err("예약 겹침: %s(%s~%s) ↔ %s(%s~%s)" % (
                a.get("guest"), a["checkin"], a["checkout"],
                b.get("guest"), b["checkin"], b["checkout"]))

    # 체크리스트 id 중복
    for gname, items in (data.get("checklist_templates") or {}).items():
        ids = [it.get("id") for it in items]
        if len(ids) != len(set(ids)):
            err("checklist_templates.%s: 항목 id 중복" % gname)
        for it in items:
            if not it.get("label"):
                err("checklist_templates.%s: label 없는 항목 %r" % (gname, it.get("id")))

    # 날짜별 청소 계산
    checkout_by = {}
    checkin_by = {}
    for s in stays:
        if s.get("checkout"):
            checkout_by.setdefault(s["checkout"], []).append(s)
        if s.get("checkin"):
            checkin_by.setdefault(s["checkin"], []).append(s)

    overrides = data.get("cleanings") or {}
    for day in overrides:
        try:
            d(day)
        except ValueError:
            err("cleanings 키가 날짜 형식이 아닙니다: %r" % day)

    base_day = args.date or datetime.date.today().isoformat()
    try:
        d(base_day)
    except ValueError:
        print("--date 형식이 올바르지 않습니다:", base_day)
        return 1

    rows = []
    for day in sorted(checkout_by):
        if day < base_day:
            continue
        ov = overrides.get(day, {})
        win = ov.get("window") or base
        start, end = win.get("start", "12:00"), win.get("end", "15:00")
        early = None
        for s in checkin_by.get(day, []):
            if s.get("early_checkin") and minutes(s["early_checkin"]) < minutes(end):
                early = s["early_checkin"]
                end = early
        outs = ", ".join("%s(%s명)" % (s["guest"], (s.get("adults") or 0) + (s.get("children") or 0) + (s.get("infants") or 0))
                         for s in checkout_by[day])
        ins = ", ".join("%s(%s명)" % (s["guest"], (s.get("adults") or 0) + (s.get("children") or 0) + (s.get("infants") or 0))
                        for s in checkin_by.get(day, [])) or "공실"
        flags = []
        if any(s.get("pets") for s in checkout_by[day]):
            flags.append("반려동물")
        if any((s.get("infants") or 0) > 0 for s in checkin_by.get(day, [])):
            flags.append("유아")
        if early:
            flags.append("조기체크인 " + early)
        if (ov.get("weather") or {}).get("rain"):
            flags.append("비")
        rows.append((day, "%s ~ %s (%s)" % (start, end, duration(start, end)),
                     outs, ins, ", ".join(flags)))

    print("=== %s 일정 검사 ===" % DATA_PATH)
    print("기준일:", base_day, "| 예약 %d건 | 청소 %d건" %
          (len(stays), len(checkout_by)))
    print()
    for day, win, outs, ins, flags in rows[:12]:
        print("%s (%s)  %s" % (day, DOW[(d(day).weekday() + 1) % 7], win))
        print("    퇴실 %s → 입실 %s%s" % (outs, ins, ("  [" + flags + "]") if flags else ""))
    print()

    if warnings:
        print("경고 %d건" % len(warnings))
        for w in warnings:
            print("  -", w)
    if errors:
        print("오류 %d건" % len(errors))
        for e in errors:
            print("  ✗", e)
        return 1
    print("오류 없음. 이 파일을 그대로 push하면 화면이 갱신됩니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
