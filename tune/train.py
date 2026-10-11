import argparse
import json
import random
import re
import time
from pathlib import Path

import torch
from peft import LoraConfig, PeftModel, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer

BASE = "unsloth/gemma-2b-it"
WORKERS_AI_BASE = "@cf/google/gemma-2b-it-lora"


def load(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]


def gemma_prompt(messages):
    turns = "".join(f"<start_of_turn>{'user' if m['role'] == 'user' else 'model'}\n{m['content']}<end_of_turn>\n" for m in messages)
    return f"{turns}<start_of_turn>model\n"


def parse_answer(text):
    line = (text.strip().split("\n") or [""])[0].strip().lower()
    return "approve" if re.match(r"^\W*approve\b", line) else "reject"


def evaluate(model, tokenizer, rows, label):
    model.eval()
    predictions = []
    started = time.time()
    for row in rows:
        prompt = gemma_prompt(row["messages"][:-1])
        ids = tokenizer(prompt, return_tensors="pt", add_special_tokens=True)
        with torch.no_grad():
            out = model.generate(**ids, max_new_tokens=24, do_sample=False)
        answer = tokenizer.decode(out[0][ids["input_ids"].shape[1]:], skip_special_tokens=True)
        predicted = parse_answer(answer)
        predictions.append({"id": row["id"], "featureId": row["featureId"], "outcome": row["outcome"], "label": row["label"], "predicted": predicted, "answer": answer.strip()[:200]})
        print(f"[{label}] {row['id']} {row['label']} -> {predicted}: {answer.strip()[:80]!r}", flush=True)
    return {"metrics": metrics(predictions), "seconds": round(time.time() - started), "predictions": predictions}


def metrics(predictions):
    n = len(predictions)
    correct = sum(p["predicted"] == p["label"] for p in predictions)
    rejects = [p for p in predictions if p["label"] == "reject"]
    approves = [p for p in predictions if p["label"] == "approve"]
    bad_approved = sum(p["predicted"] == "approve" for p in rejects)
    good_rejected = sum(p["predicted"] == "reject" for p in approves)
    return {
        "examples": n,
        "accuracy": round(correct / n, 3) if n else 0,
        "bad_changes_caught": f"{len(rejects) - bad_approved}/{len(rejects)}",
        "good_changes_approved": f"{len(approves) - good_rejected}/{len(approves)}",
        "bad_changes_approved": bad_approved,
        "good_changes_rejected": good_rejected,
    }


def encode(tokenizer, row, max_tokens):
    prompt = gemma_prompt(row["messages"][:-1])
    target = row["messages"][-1]["content"] + "<end_of_turn>\n"
    prompt_ids = tokenizer(prompt, add_special_tokens=True)["input_ids"]
    target_ids = tokenizer(target, add_special_tokens=False)["input_ids"]
    ids = (prompt_ids + target_ids)[-max_tokens:]
    labels = ([-100] * len(prompt_ids) + target_ids)[-max_tokens:]
    return torch.tensor([ids]), torch.tensor([labels])


def train(model, tokenizer, rows, epochs, lr, accumulate, max_tokens, seed):
    random.seed(seed)
    model.train()
    params = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(params, lr=lr, weight_decay=0.0)
    total = epochs * len(rows) // accumulate
    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lambda step: max(0.0, 1 - step / max(1, total)))
    history = []
    step = 0
    for epoch in range(epochs):
        order = rows[:]
        random.shuffle(order)
        running = 0.0
        for i, row in enumerate(order):
            ids, labels = encode(tokenizer, row, max_tokens)
            loss = model(input_ids=ids, labels=labels).loss
            (loss / accumulate).backward()
            running += loss.item()
            if (i + 1) % accumulate == 0 or i + 1 == len(order):
                torch.nn.utils.clip_grad_norm_(params, 1.0)
                optimizer.step()
                scheduler.step()
                optimizer.zero_grad()
                step += 1
        history.append({"epoch": epoch + 1, "loss": round(running / len(order), 4)})
        print(f"epoch {epoch + 1}: loss {running / len(order):.4f}", flush=True)
    return history


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="tune/data")
    parser.add_argument("--out", default="tune/out")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--rank", type=int, default=8)
    parser.add_argument("--accumulate", type=int, default=4)
    parser.add_argument("--max-tokens", type=int, default=1536)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--threads", type=int, default=0)
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    if args.threads:
        torch.set_num_threads(args.threads)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    train_rows = load(Path(args.data) / "train.jsonl")
    heldout_rows = load(Path(args.data) / "heldout.jsonl")
    tokenizer = AutoTokenizer.from_pretrained(BASE)
    model = AutoModelForCausalLM.from_pretrained(BASE, dtype=torch.bfloat16)
    model.config.use_cache = False

    results = {"base_model": BASE, "workers_ai_base": WORKERS_AI_BASE, "train_examples": len(train_rows), "heldout_examples": len(heldout_rows)}
    results["base"] = evaluate(model, tokenizer, heldout_rows, "base")

    config = LoraConfig(r=args.rank, lora_alpha=2 * args.rank, lora_dropout=0.05, target_modules=["q_proj", "k_proj", "v_proj", "o_proj"], task_type="CAUSAL_LM")
    model = get_peft_model(model, config)
    started = time.time()
    results["training"] = {"epochs": args.epochs, "lr": args.lr, "rank": args.rank, "accumulate": args.accumulate, "seed": args.seed, "history": train(model, tokenizer, train_rows, args.epochs, args.lr, args.accumulate, args.max_tokens, args.seed)}
    results["training"]["seconds"] = round(time.time() - started)

    adapter = out / "adapter"
    model.save_pretrained(adapter)
    adapter_config = json.loads((adapter / "adapter_config.json").read_text())
    adapter_config["model_type"] = "gemma"
    (adapter / "adapter_config.json").write_text(json.dumps(adapter_config, indent=2))

    results["tuned"] = evaluate(model, tokenizer, heldout_rows, "tuned")
    results["tuned_on_train"] = {"metrics": evaluate(model, tokenizer, train_rows, "tuned-train")["metrics"]}
    (out / "results.json").write_text(json.dumps(results, indent=1) + "\n")
    print(json.dumps({k: results[k]["metrics"] for k in ("base", "tuned", "tuned_on_train")}, indent=1))


if __name__ == "__main__":
    main()
