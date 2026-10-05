# CosyVoice sidecar for Agent Wardrobe: zero-shot voice cloning from a short reference clip.
# Speaks the stdio protocol in voice-engines/sidecar.cjs ("@voice {json}" lines). No network listener.
# Usage: python cosyvoice_sidecar.py --src <CosyVoice source> --model <model folder>
import argparse, hashlib, json, os, queue, sys, threading, time

def emit(message):
    sys.stdout.write('@voice ' + json.dumps(message, ensure_ascii=False) + '\n')
    sys.stdout.flush()

parser = argparse.ArgumentParser()
parser.add_argument('--src', required=True)
parser.add_argument('--model', required=True)
parser.add_argument('--threads', type=int, default=0)
parser.add_argument('--wetext', default='')  # text-normalisation grammars fetched by the app's installer
args = parser.parse_args()

inbox = queue.Queue()
cancelled = set()

def reader():
    for line in sys.stdin:
        try:
            message = json.loads(line)
        except ValueError:
            continue
        if message.get('op') == 'cancel':
            cancelled.add(message.get('id'))
        else:
            inbox.put(message)
    inbox.put({'op': 'quit'})

try:
    sys.path.insert(0, args.src)
    sys.path.insert(0, os.path.join(args.src, 'third_party', 'Matcha-TTS'))
    import torch, torchaudio
    if args.threads:
        torch.set_num_threads(args.threads)
    if args.wetext and os.path.isdir(args.wetext):
        import wetext.wetext  # use the local grammars instead of downloading the whole repo at run time
        wetext.wetext.snapshot_download = lambda *a, **k: args.wetext
    from cosyvoice.cli.cosyvoice import AutoModel
    started = time.time()
    model = AutoModel(model_dir=args.model)
    version3 = os.path.exists(os.path.join(args.model, 'cosyvoice3.yaml'))
except Exception as error:  # report and exit; the app shows the message
    emit({'fatal': f'{type(error).__name__}: {error}'})
    sys.exit(1)

# CosyVoice 3 expects a system prompt in front of the prompt text (zero-shot) or the text (cross-lingual)
SYSTEM = 'You are a helpful assistant.<|endofprompt|>'
speakers = {}

def speaker_id(ref, ref_text):
    stat = os.stat(ref)
    key = hashlib.sha1(f'{ref}|{stat.st_mtime_ns}|{stat.st_size}|{ref_text}'.encode()).hexdigest()[:16]
    if key not in speakers:
        prompt = (SYSTEM + ref_text) if version3 else ref_text
        model.add_zero_shot_spk(prompt, ref, key)
        speakers[key] = True
    return key

def speak(message):
    request_id = message['id']
    text, ref, ref_text = message['text'], message['ref'], message.get('refText') or ''
    speed = float(message.get('speed') or 1.0)
    began = time.time()
    if ref_text and message.get('mode') != 'cross_lingual':
        spk = speaker_id(ref, ref_text)
        chunks = model.inference_zero_shot(text, '', '', zero_shot_spk_id=spk, stream=False, speed=speed)
    else:
        chunks = model.inference_cross_lingual((SYSTEM + text) if version3 else text, ref, stream=False, speed=speed)
    parts = []
    for index, chunk in enumerate(chunks):
        if request_id in cancelled:
            cancelled.discard(request_id)
            return {'id': request_id, 'ok': False, 'error': 'cancelled'}
        parts.append(chunk['tts_speech'])
        emit({'id': request_id, 'progress': index + 1})
    if not parts:
        return {'id': request_id, 'ok': False, 'error': 'no audio produced'}
    audio = torch.cat(parts, dim=1)
    torchaudio.save(message['out'], audio, model.sample_rate, encoding='PCM_S', bits_per_sample=16, backend='soundfile')
    seconds = audio.shape[1] / model.sample_rate
    return {'id': request_id, 'ok': True, 'out': message['out'], 'sampleRate': model.sample_rate, 'seconds': round(seconds, 2), 'took': round(time.time() - began, 2)}

threading.Thread(target=reader, daemon=True).start()
emit({'ready': True, 'device': 'cpu', 'sampleRate': model.sample_rate, 'version': 3 if version3 else 2, 'loadSeconds': round(time.time() - started, 1), 'torch': torch.__version__, 'textFrontend': model.frontend.text_frontend or 'none'})
while True:
    message = inbox.get()
    op = message.get('op')
    if op == 'quit':
        break
    try:
        if op == 'speak':
            emit(speak(message))
        elif op == 'ping':
            emit({'id': message.get('id'), 'ok': True})
        else:
            emit({'id': message.get('id'), 'ok': False, 'error': f'unknown op {op}'})
    except Exception as error:
        emit({'id': message.get('id'), 'ok': False, 'error': f'{type(error).__name__}: {error}'})
