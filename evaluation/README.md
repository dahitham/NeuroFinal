# NeuroSync evaluation (anonymous research data)

Optional usability research. **Nothing is pre-filled** – every figure comes from real submissions.

## How it works
1. In the web app, **Settings → Research & privacy** shows: *"Your evaluation data will be collected anonymously for research and usability analysis."* and a switch (off until the user opts in).
2. Only after opting in – and only after finishing the assessment – can the user submit **Settings → Share feedback**: four ratings (1–5: ease of reading, navigation ease, usefulness, satisfaction) and a task-completion answer.
3. The **backend** builds the record from the user's *stored* assessment and settings (the browser cannot inject measurements) and saves it with an anonymous id (`P001`, `P002`, …) and a random session id. The record is **not linked to the account**.
4. Switching consent off stops all further collection. Responses already shared are anonymous and cannot be traced back to be deleted.

## Fields
`Participant_ID, Session_ID, Reading_Time, Assessment_Score, Comprehension_Score, Assistance_Level, Font, Font_Size, Line_Spacing, Letter_Spacing, Word_Spacing, Bionic_Reading, Color_Tint, TTS, Reader_Mode, Focus_Mode, Preference_Congruence, Task_Completion, Ease_of_Reading, Navigation_Ease, Usefulness, Satisfaction`

The export keeps its stable column set. With the current supplied assessment records, `Reading_Time`
and `Preference_Congruence` are blank because those datasets do not collect passage timing or
preference answers. `Comprehension_Score` is calculated from the `comprehension` category; no
missing measurements are inferred or filled in.

Never collected: names, e-mails, user ids, phone numbers, addresses, ID numbers, medical diagnoses. A test asserts that no name or e-mail can appear in the CSV.

## Reading the data (research team)
Set `RESEARCH_ADMIN_EMAILS=you@example.com` in `backend/.env`; those signed-in accounts can call
- `GET /api/evaluation` – count, **descriptive statistics** (mean, median, sample SD, task-completion rate, preference congruence when available, distributions) and the records
- `GET /api/evaluation/export` – the CSV (also **Settings → Download research CSV** for those accounts)

If there are no records the API returns `statistics: null` – there is nothing to chart, and nothing is invented.

## Offline summary of exported CSV files
```bash
node evaluation/analysis/summarize.mjs evaluation/exports/*.csv
```

## Definitions
- **Mean / median / SD** – SD is the *sample* standard deviation (n − 1), reported only when n ≥ 2.
- **Task completion rate** – share of submissions where the participant answered "able to complete".
- **Preference congruence** – retained for compatible historical records; blank for current assessments because no preference questions are in the supplied datasets.
- **Assessment score** – the 0–14 Recommended Assistance Level heuristic, based on incorrect-answer rate across the supplied categories; not a clinically validated measure.
