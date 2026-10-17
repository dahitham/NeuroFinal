# Datasets

These are the **original, unmodified** NeuroSync dataset files. The app reads them directly (the Vite alias `@datasets` points here); nothing is copied or rewritten. Differences in structure are handled by the adapter in `frontend/src/data/datasetAdapter.js`.

| File | Shape | Used for |
| --- | --- | --- |
| `Speed_and_Comprehension.json` | `{dataset_metadata, items[]}` – `id, difficulty, word_count, passage, question, options, correct_answer` | Reading speed (WPM) + Comprehension |
| `Word_Difficulty_Test.json` | `{dataset_metadata, items[]}` – `id, difficulty, target_word, context_sentence, options, correct_answer` (no `question`) | Word difficulty test **and** the local vocabulary |
| `Focus_Test.json` | `{dataset_metadata, items[]}` – `id, trigger, question, options[{text, score_impact}]` | Focus / comfort self-report (0–5 points) |
| `Reading_Preference___Font_Preference.json` | `{dataset_metadata, items[]}` – `id, test_category, ui_options, test_text…` | Preference test (font, spacing, bionic, simplification, colour) |
| `Memory_Recall.json`, `Pattern_Recognition.json`, `Sentence_Completion.json`, `Word_Sequencing.json` | bare arrays – `id, difficulty (easy/medium/hard), question, options, correct_answer` | Cognitive assessment |

Adapter notes
- IDs are namespaced per module (`speed_and_comprehension:SC-E-01`) because `Sentence_Completion` and `Speed_and_Comprehension` both use `SC-…` ids.
- Memory Recall questions contain `Fact: … Question?`; the adapter splits fact and question so the fact can be shown first and then hidden.
- Items whose `correct_answer` is not one of their `options` are skipped and reported, never "fixed". Currently **`Word_Sequencing.json › WS-H-02`** is affected (its `correct_answer` omits a word and two options are identical), so the Word Sequencing section uses 49 of 50 items. Fix the item in the source file if you want it included.
- File names are matched loosely (spaces / underscores / `&` are ignored), so both `Focus Test.json` and `Focus_Test.json` work.
