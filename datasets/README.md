# Assessment datasets

The assessment loader reads only `neurosync_*.json` files in this directory. The five supplied
files are the authoritative assessment source; legacy assessment JSON files are not loaded.
The original files in `new datasets/` are kept unchanged, and the copies here are byte-identical.

| File | Category | Format |
| --- | --- | --- |
| `neurosync_attention_to_detail.json` | `attention_to_detail` | Metadata object with `questions[]` |
| `neurosync_comprehension.json` | `comprehension` | Metadata object with `questions[]` |
| `neurosync_sentence_understanding.json` | `sentence_understanding` | Metadata object with `questions[]` |
| `neurosync_sequencing.json` | `sequencing` | Metadata object with `questions[]` |
| `neurosync_word_recognition.json` | `word_recognition` | Metadata object with `questions[]` |

Each record contains `id`, `category`, `difficulty`, `skill`, `questionType`, `question`,
`options[{id,text}]`, `correctAnswer` (an option ID), and `explanation`. The adapter preserves
option IDs and source values while building category-specific pools. Startup validation reports
malformed records with their source file and record ID/row, and fails rather than silently
skipping records or loading old assessment data.

The existing `extension/data/vocabulary.json` is an independent word-help resource, not an
assessment bank. The supplied recognition questions do not contain definitions, so that resource
is kept separate and is never generated from the assessment questions.
