# Dream Story 청소 일정 대시보드

에어비앤비 독채 **Dream Story** 청소 이모님·호스트용 모바일 웹 대시보드.
카카오톡으로 링크를 보내면 스마트폰 브라우저에서 바로 열립니다.

- 주소: GitHub Pages에 올리면 `https://<계정>.github.io/<저장소>/`
- 잠금: 4자리 PIN (기본 `1470` — `data/schedule.json`의 `meta.pin`)
- 데이터: `data/schedule.json` **한 파일만 고치면** 화면 전체가 다시 계산됩니다.

---

## 1. 파일 구조

```
dream-story-cleaning/
├─ index.html          화면 뼈대 (GitHub Pages 루트)
├─ styles.css          모바일 우선 스타일
├─ app.js              일정 계산·렌더링·PIN 잠금
├─ data/
│  └─ schedule.json    ← 일정 데이터 (여기만 갱신)
├─ tools/
│  ├─ check_schedule.py 일정 검사 + 다음 청소 요약
│  └─ preview.py        390px 모바일 스크린샷 생성
└─ preview*.png        확인용 스크린샷
```

`index.html`이 루트에 있으므로 이 폴더를 그대로 GitHub Pages에 올리면 됩니다.

---

## 2. 일정 갱신 방법 (3단계)

1. `data/schedule.json`의 **`stays`** 배열에 예약을 추가·수정합니다.
2. `meta.last_updated`를 현재 시각으로 바꿉니다. (예: `"2026-11-22T09:00:00+09:00"`)
3. 검사 후 push합니다.

```bash
python3 tools/check_schedule.py       # 오류·겹치는 예약 확인
git add -A && git commit -m "청소 일정 갱신 11/22" && git push
```

push 후 페이지를 열면 `schedule.json`을 새로 받아옵니다(캐시 방지 쿼리 자동 첨부).
청소 카드·준비물 수량·체크리스트는 `stays`에서 **자동 계산**되므로 따로 적지 않습니다.

### 예약 한 건 (stays 항목)

| 필드 | 설명 | 예 |
|---|---|---|
| `guest` | 게스트 이름 (화면에 그대로 표시) | `"승규"` |
| `checkin` / `checkout` | 입실·퇴실 날짜 (`YYYY-MM-DD`) | `"2026-11-23"` |
| `checkin_time` / `checkout_time` | 시각 (`HH:MM`) | `"15:00"` / `"12:00"` |
| `early_checkin` | 조기 체크인 시각. 있으면 청소 시간 창이 자동으로 줄어듭니다 | `"13:00"` |
| `early_checkin_note` | 약속 범위 등 표시용 메모 | `"13:00~13:30"` |
| `adults` / `children` / `infants` | 성인·어린이·유아 수 | `6` / `0` / `1` |
| `pets` | 반려동물 `[{ "type": "고양이", "count": 1 }]` | 퇴실 카드에 털 제거 안내가 붙습니다 |
| `nights` | 숙박 일수 (없으면 날짜로 계산) | `1` |
| `ops_notes` | 이모님께 보여줄 특이사항 문장 배열 | `["주차 1대 — 공영주차장 부개동 206-1"]` |
| `host_notes` | 호스트 화면에서만 보이는 메모 | `["₩133,510 · 1박"]` |
| `id` | 에어비앤비 예약번호 (선택) | `"HMHAPEYW5K"` |

### 그 밖의 항목

- **`cleanings`** — 특정 날짜만 손볼 때 쓰는 덮어쓰기.
  ```json
  "2026-11-25": {
    "window": { "start": "12:00", "end": "18:00" },
    "weather": { "summary": "비 88%", "rain": true },
    "notes": ["다음 입실이 11/26이라 시간 여유가 있습니다."]
  }
  ```
  `weather.rain`이면 체크리스트에 비 대비 항목이 추가됩니다.
- **`alerts`** — 날짜별 긴급/안내 알림. `level`은 `urgent` 또는 `info`.
- **`pending`** — 확정되지 않은 예약 요청(대기 표시).
- **`supply_rules`** — 수건·베개·침구 수량 규칙. 인원수에 곱해 화면에 표시됩니다.
- **`checklist_templates`** — 기본/`pet`/`infant`/`large`/`rain` 체크리스트 문구.

---

## 3. PIN 바꾸기

`data/schedule.json`의 `meta.pin`을 4자리 숫자로 바꾸고 push하면,
이전 PIN으로 저장된 기기 잠금은 자동으로 풀리지 않고 **다시 입력**을 요구합니다.

> PIN은 "이모님·호스트만 보게" 하는 가벼운 잠금입니다. 페이지 소스와 JSON은
> 공개 주소에 올라가므로, 민감한 개인정보(전화번호·정산 금액 등)는 넣지 마세요.
> 진짜 접근 제어가 필요하면 Cloudflare Access 같은 별도 수단이 필요합니다.

---

## 4. 로컬에서 확인

```bash
python3 -m http.server 8811 --directory work/dream-story-cleaning
# 브라우저에서 http://127.0.0.1:8811/index.html
```

- `?date=2026-11-23`처럼 날짜를 붙이면 그날 기준 화면을 미리 볼 수 있습니다.
- 스크린샷 생성:

```bash
pip install playwright && python3 -m playwright install chromium
python3 work/dream-story-cleaning/tools/preview.py
```

---

## 5. GitHub Pages 배포

1. 이 폴더를 저장소 루트(또는 `docs/`)로 push
2. 저장소 **Settings → Pages → Build and deployment**
   - Source: `Deploy from a branch`
   - Branch: `main` / 폴더: `/ (root)` 또는 `/docs`
3. 잠시 뒤 `https://<계정>.github.io/<저장소>/` 접속
4. 카카오톡으로 링크 전송 (이모님께는 PIN을 따로 알려 주세요)

---

## 6. 화면 사용

| 화면 | 내용 |
|---|---|
| **오늘** | 오늘 청소 유무·시간 창·긴급 알림, 퇴실/입실 팀, 준비물 수량, 특이사항, 체크리스트 |
| **다가오는** | 2주 안 청소 목록. 카드를 누르면 준비물·특이사항이 펼쳐짐 |
| **전체 일정** | 월별 캘린더(입·퇴·청), 예약별 입·퇴실, 대기 문의 |

- **이모님용 / 호스트 확인용** 전환: 상단 토글. 호스트 모드에서는 예약번호·금액과
  데이터 상태 패널이 추가로 보입니다.
- **체크리스트**: 터치하면 기기에 저장됩니다(브라우저 `localStorage`). 기기별로
  따로 저장되며, 호스트 모드의 **초기화** 버튼으로 그날 체크를 지울 수 있습니다.
- **잠금** 버튼: 다시 PIN을 요구합니다.
