# Transcreve a reuniao NTB (16/06) com faster-whisper, escrita incremental.
# Saida: transcricao.txt (com timestamps), .srt e progresso.log na pasta de trabalho.
import os, time
from faster_whisper import WhisperModel

AUDIO = r"C:\Users\media\Videos\ntb-reuniao-2026-06-16.wav"
OUTDIR = r"C:\Users\media\Videos\ntb-reuniao-2026-06-16"
os.makedirs(OUTDIR, exist_ok=True)
OUT_TXT = os.path.join(OUTDIR, "transcricao.txt")
OUT_SRT = os.path.join(OUTDIR, "transcricao.srt")
PROG = os.path.join(OUTDIR, "progresso.log")

def hhmmss(s):
    h = int(s // 3600); m = int((s % 3600) // 60); sec = s % 60
    return f"{h:02d}:{m:02d}:{sec:06.3f}"

def srt_time(s):
    h = int(s // 3600); m = int((s % 3600) // 60); sec = int(s % 60); ms = int((s - int(s)) * 1000)
    return f"{h:02d}:{m:02d}:{sec:02d},{ms:03d}"

print("carregando modelo small int8...", flush=True)
model = WhisperModel("small", device="cpu", compute_type="int8")
print("iniciando transcricao...", flush=True)

segments, info = model.transcribe(
    AUDIO, language="pt", beam_size=5,
    vad_filter=True, vad_parameters=dict(min_silence_duration_ms=500),
)
dur = info.duration

ft = open(OUT_TXT, "w", encoding="utf-8")
fs = open(OUT_SRT, "w", encoding="utf-8")
t0 = time.time(); n = 0
for seg in segments:
    n += 1
    txt = seg.text.strip()
    ft.write(f"[{hhmmss(seg.start)} -> {hhmmss(seg.end)}] {txt}\n"); ft.flush()
    fs.write(f"{n}\n{srt_time(seg.start)} --> {srt_time(seg.end)}\n{txt}\n\n"); fs.flush()
    if n % 10 == 0:
        el = time.time() - t0
        spd = (seg.end / el) if el > 0 else 0
        with open(PROG, "w", encoding="utf-8") as fp:
            fp.write(f"segmentos={n} pos={seg.end:.0f}s/{dur:.0f}s elapsed={el:.0f}s speed={spd:.2f}x\n")
ft.close(); fs.close()
with open(PROG, "w", encoding="utf-8") as fp:
    fp.write(f"DONE segmentos={n} elapsed={time.time()-t0:.0f}s dur={dur:.0f}s\n")
print(f"PRONTO: {n} segmentos em {time.time()-t0:.0f}s", flush=True)
