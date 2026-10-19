"""
YAMNet sound labels for the haptics film test (docs/haptics-decisions.md, Sound recognition).

For each <name>.mka in .haptics-fixtures/films, writes <name>.yamnet.npy: one row of 521 scores
(float16) per 0.48 s hop, row k covering [k*0.48, k*0.48 + 0.975) s. The audio is the first track,
downmixed to mono at 16 kHz, as the phone will feed it. Existing files are kept.

Setup (once): python -m venv .haptics-fixtures/venv, then pip install tensorflow numpy, and put
yamnet.tflite (MediaPipe, float32) and yamnet_class_map.csv in .haptics-fixtures/yamnet.
Run: .haptics-fixtures/venv/Scripts/python -I scripts/haptics-yamnet.py
"""
import os
import subprocess
import sys
import time

import numpy as np
import tensorflow as tf

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".haptics-fixtures")
FILMS = os.path.join(ROOT, "films")
MODEL = os.path.join(ROOT, "yamnet", "yamnet.tflite")
RATE = 16000
WINDOW = 15600
HOP = 7680  # 0.48 s, YAMNet's own hop


def decode(path):
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-map", "0:a:0", "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(pcm, dtype=np.float32)


def label(audio):
    it = tf.lite.Interpreter(model_path=MODEL, num_threads=os.cpu_count())
    it.allocate_tensors()
    inp = it.get_input_details()[0]["index"]
    out = it.get_output_details()[0]["index"]
    n = max(0, (len(audio) - WINDOW) // HOP + 1)
    scores = np.zeros((n, 521), dtype=np.float16)
    for k in range(n):
        it.set_tensor(inp, audio[k * HOP:k * HOP + WINDOW])
        it.invoke()
        scores[k] = it.get_tensor(out)[0]
    return scores


def main():
    names = sys.argv[1:] or sorted(f[:-4] for f in os.listdir(FILMS) if f.endswith(".mka"))
    for name in names:
        dst = os.path.join(FILMS, name + ".yamnet.npy")
        if os.path.exists(dst):
            print(f"{name}: kept")
            continue
        t0 = time.time()
        audio = decode(os.path.join(FILMS, name + ".mka"))
        t1 = time.time()
        scores = label(audio)
        t2 = time.time()
        np.save(dst, scores)
        minutes = len(audio) / RATE / 60
        print(f"{name}: {minutes:.1f} min, {len(scores)} frames, decode {t1 - t0:.0f} s, label {t2 - t1:.0f} s "
              f"({minutes * 60 / (t2 - t1):.0f}x realtime, {1000 * (t2 - t1) / max(1, len(scores)):.1f} ms/frame)")


if __name__ == "__main__":
    main()
