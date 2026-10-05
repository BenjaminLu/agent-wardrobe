# GPT-SoVITS inference sidecar for Agent Wardrobe. Speaks the stdio protocol in voice-engines/sidecar.cjs.
# One process keeps one pair of weights loaded and switches when a request names another voice.
# Usage: python sovits_sidecar.py --src <GPT-SoVITS source> [--device cpu|mps]
import argparse, json, os, queue, sys, threading, time

def emit(message):
    sys.stdout.write('@voice ' + json.dumps(message, ensure_ascii=False) + '\n')
    sys.stdout.flush()

parser = argparse.ArgumentParser()
parser.add_argument('--src', required=True)
parser.add_argument('--device', default='cpu')
args = parser.parse_args()
inbox, cancelled = queue.Queue(), set()

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
    os.chdir(args.src)
    sys.path[:0] = [args.src, os.path.join(args.src, 'GPT_SoVITS')]
    import numpy as np, soundfile as sf
    from TTS_infer_pack.TTS import TTS, TTS_Config
    pre = os.path.join('GPT_SoVITS', 'pretrained_models')
    config = TTS_Config({'custom': {'device': args.device, 'is_half': False, 'version': 'v2Pro',
                                    't2s_weights_path': os.path.join(pre, 's1v3.ckpt'), 'vits_weights_path': os.path.join(pre, 'v2Pro', 's2Gv2Pro.pth'),
                                    'bert_base_path': os.path.join(pre, 'chinese-roberta-wwm-ext-large'), 'cnhuhbert_base_path': os.path.join(pre, 'chinese-hubert-base')}})
    tts = TTS(config)
except Exception as error:
    emit({'fatal': f'{type(error).__name__}: {error}'})
    sys.exit(1)

loaded = {'gpt': None, 'sovits': None}
LANG = {'zh': 'all_zh', 'ja': 'all_ja', 'en': 'en', 'ko': 'all_ko', 'yue': 'all_yue', 'auto': 'auto'}

def speak(message):
    if loaded['sovits'] != message['sovits']:
        tts.init_vits_weights(message['sovits'])
        loaded['sovits'] = message['sovits']
    if loaded['gpt'] != message['gpt']:
        tts.init_t2s_weights(message['gpt'])
        loaded['gpt'] = message['gpt']
    began = time.time()
    parts, rate = [], 32000
    for rate, chunk in tts.run({'text': message['text'], 'text_lang': LANG.get(message.get('textLang'), 'auto'),
                                'ref_audio_path': message['ref'], 'prompt_text': message.get('refText', ''),
                                'prompt_lang': LANG.get(message.get('refLang'), 'auto'), 'top_k': int(message.get('topK', 15)),
                                'top_p': 1, 'temperature': float(message.get('temperature', 1)), 'text_split_method': 'cut5',
                                'speed_factor': float(message.get('speed', 1)), 'batch_size': 1, 'parallel_infer': False}):
        if message['id'] in cancelled:
            cancelled.discard(message['id'])
            tts.stop()
            return {'id': message['id'], 'ok': False, 'error': 'cancelled'}
        parts.append(chunk)
    audio = np.concatenate(parts) if parts else np.zeros(0, dtype=np.int16)
    sf.write(message['out'], audio, rate, subtype='PCM_16')
    return {'id': message['id'], 'ok': True, 'out': message['out'], 'sampleRate': rate, 'seconds': round(len(audio) / rate, 2), 'took': round(time.time() - began, 2)}

threading.Thread(target=reader, daemon=True).start()
emit({'ready': True, 'device': args.device, 'version': 'v2Pro'})
while True:
    message = inbox.get()
    op = message.get('op')
    if op == 'quit':
        break
    try:
        emit(speak(message) if op == 'speak' else {'id': message.get('id'), 'ok': op == 'ping'})
    except Exception as error:
        emit({'id': message.get('id'), 'ok': False, 'error': f'{type(error).__name__}: {error}'})
