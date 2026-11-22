"""Writes the fixtures of the speaker detection tests (src/speakers.rs, src/fbank.rs).

    pip install numpy==2.5.5 scipy==1.18.1 kaldi-native-fbank==1.23.3 onnxruntime==1.32.0
    python -I fixtures/make-speaker-fixtures.py path/to/speaker-model.onnx

Run it from apps/desktop/src-tauri with espeak-ng 1.51 and cargo on the PATH.
The model must be the pinned file (SPEAKER_MODEL in src/speakers.rs); its
SHA-256 is checked before it is opened. It writes, next to this script:

  fbank-reference.f32        kaldi-native-fbank's features of a fixed test
                             signal (100 rows of 80 little-endian f32)
  two-speakers.rttm          who speaks when in the dialogue below
  two-speakers.opus          a dialogue of two espeak-ng voices, compressed by
                             the app's own encoder (through cargo)
  speaker-clip.wav           1.5 s of the first voice, 16 kHz mono PCM
  speaker-clip-embedding.f32 onnxruntime's voice print of that clip (192 f32)

The signal, the turns and the noise are seeded, so a rerun with the same
espeak-ng gives the same files.
"""

import hashlib
import math
import os
import random
import subprocess
import sys
import tempfile
import wave

import kaldi_native_fbank as knf
import numpy as np
import onnxruntime as ort
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_SHA256 = "53cab20ba8f2eb2f6e2d89ecc18e88ef3222169b61b4419cbc13666744a4574b"
RATE = 16000
VOICES = ["en-us+m3", "en-us+f2"]
LINES = [
    "Thanks for joining me today, I wanted to go over the plan for the next release.",
    "Sure. Where do you want to start?",
    "Let's start with the recording quality, because people keep asking about it.",
    "Right.",
    "The engine works at sixteen kilohertz, so anything above that is wasted for transcription.",
    "That makes sense, but what about interviews recorded outdoors?",
    "We could keep the original file next to the compressed one.",
    "Okay.",
    "I think the bigger problem is speaker labels in long meetings.",
    "Yes, absolutely. Nobody wants to name forty segments by hand.",
    "So the idea is a button that detects speakers and fills in the names.",
    "And then you rename them once?",
    "Exactly, you rename speaker one to Alice and every segment follows.",
    "How long would that take for an hour of audio?",
    "Around a minute on a laptop, and nothing leaves the computer.",
    "Nice.",
    "What happens when two people talk at the same time?",
    "The segment goes to whoever spoke most of it.",
    "Let's also make sure the French interface has the same wording.",
    "I'll check the translations this afternoon.",
]


def fbank(samples):
    """The features the speaker model was trained with (see src/fbank.rs)."""
    options = knf.FbankOptions()
    options.frame_opts.dither = 0.0
    options.frame_opts.snip_edges = False
    options.frame_opts.samp_freq = RATE
    options.mel_opts.num_bins = 80
    options.mel_opts.low_freq = 20
    options.mel_opts.high_freq = -400
    features = knf.OnlineFbank(options)
    features.accept_waveform(RATE, samples.tolist())
    features.input_finished()
    rows = [features.get_frame(i) for i in range(features.num_frames_ready)]
    return np.array(rows, dtype=np.float32)


def reference_signal():
    """The same signal as reference_signal() in src/fbank.rs."""
    state = 12345
    values = []
    for i in range(RATE):
        t = i / RATE
        state = (state * 1664525 + 1013904223) & 0xFFFFFFFF
        noise = (state >> 8) / (1 << 24) * 2.0 - 1.0
        value = (
            0.3 * math.sin(math.tau * 220.0 * t)
            + 0.2 * math.sin(math.tau * 1375.0 * t + 0.5)
            + 0.1 * math.sin(math.tau * (300.0 * t + 1500.0 * t * t))
            + 0.02 * noise
        )
        scaled = value * 32767.0
        # Rust's f64::round: halves away from zero.
        rounded = math.copysign(math.floor(abs(scaled) + 0.5), scaled)
        values.append(int(rounded))
    return np.array(values, dtype=np.int16).astype(np.float32) / np.float32(32768.0)


def say(text, voice):
    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, "turn.wav")
        subprocess.run(["espeak-ng", "-v", voice, "-s", "165", "-w", path, text], check=True)
        with wave.open(path) as speech:
            rate = speech.getframerate()
            audio = np.frombuffer(speech.readframes(speech.getnframes()), dtype="<i2")
    audio = audio.astype(np.float32) / 32768.0
    audio = resample_poly(audio, RATE, rate).astype(np.float32)
    # Trim the synthesiser's own silence so the reference times are tight.
    loud = np.where(np.abs(audio) > 0.01)[0]
    return audio[max(0, loud[0] - 160) : loud[-1] + 160]


def write_wav(path, samples):
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(samples.astype("<i2").tobytes())


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    model = sys.argv[1]
    with open(model, "rb") as file:
        if hashlib.sha256(file.read()).hexdigest() != MODEL_SHA256:
            sys.exit(f"{model} is not the pinned speaker model")

    fbank(reference_signal()).astype("<f4").tofile(os.path.join(HERE, "fbank-reference.f32"))

    choose = random.Random(7)
    pieces, turns, at = [], [], 0.0
    for index, text in enumerate(LINES):
        voice = VOICES[index % 2]
        speech = say(text, voice)
        gap = choose.uniform(0.25, 0.9)
        pieces.append(np.zeros(int(gap * RATE), np.float32))
        at += len(pieces[-1]) / RATE
        pieces.append(speech / max(1e-3, np.abs(speech).max()) * choose.uniform(0.4, 0.8))
        turns.append((at, len(speech) / RATE, voice))
        at += len(speech) / RATE
    pieces.append(np.zeros(RATE // 2, np.float32))
    dialogue = np.concatenate(pieces)
    # A little room noise.
    dialogue += np.random.default_rng(1).normal(0, 0.002, len(dialogue)).astype(np.float32)
    dialogue = np.clip(np.round(dialogue * 32767.0), -32768, 32767).astype(np.int16)
    with open(os.path.join(HERE, "two-speakers.rttm"), "w") as rttm:
        for start, length, voice in turns:
            rttm.write(
                f"SPEAKER two-speakers 1 {start:.3f} {length:.3f} <NA> <NA> {voice} <NA> <NA>\n"
            )

    # 1.5 s from the middle of the first turn.
    start = int((turns[0][0] + turns[0][1] / 2 - 0.75) * RATE)
    clip = dialogue[start : start + RATE * 3 // 2]
    write_wav(os.path.join(HERE, "speaker-clip.wav"), clip)
    features = fbank(clip.astype(np.float32) / np.float32(32768.0))
    features -= features.mean(axis=0, keepdims=True)
    session = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    name = session.get_inputs()[0].name
    embedding = session.run(None, {name: features[None]})[0][0]
    embedding.astype("<f4").tofile(os.path.join(HERE, "speaker-clip-embedding.f32"))

    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, "two-speakers.wav")
        write_wav(path, dialogue)
        subprocess.run(
            ["cargo", "test", "--locked", "--", "--ignored", "--exact",
             "speakers::tests::write_dialogue_fixture"],
            cwd=os.path.dirname(HERE),
            env={**os.environ, "SONOLECT_FIXTURE_WAV": path},
            check=True,
        )
    print(f"{len(dialogue) / RATE:.1f} s, {len(turns)} turns, {len(VOICES)} voices")


if __name__ == "__main__":
    main()
