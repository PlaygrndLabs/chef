# Tuned reviewer

`data/` holds reviewer examples exported from real benchmark runs by `node --import tsx cli/src/bin.ts tune data`: `train.jsonl` from the 20 training features, `heldout.jsonl` from 10 features the adapter never sees, the coder turns of each run, and each run's benchmark report.

Train and compare on CPU (about 15 GB of memory; Gemma 2B loads in bfloat16):

```
python -m venv .venv
.venv/bin/pip install -r tune/requirements.txt
.venv/bin/python tune/train.py --data tune/data --out tune/out
```

The script scores the base model on the held-out examples, trains a rank 8 LoRA on the attention projections with loss on the answer only, scores the tuned model on the same examples, and writes `out/results.json` and `out/adapter/` (`adapter_model.safetensors` and `adapter_config.json` with `model_type: gemma`, as Workers AI requires).

Serve it from Workers AI:

```
cd workers
npx wrangler ai finetune create @cf/google/gemma-2b-it-lora chef-reviewer ../tune/out/adapter
```

Then set `REVIEWER_LORA` to `chef-reviewer` in `workers/wrangler.jsonc` vars.
