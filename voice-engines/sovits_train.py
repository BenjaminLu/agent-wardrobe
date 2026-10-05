# GPT-SoVITS fine-tuning driver for Agent Wardrobe (follows webui.py's 1abc → GPT (s1) → SoVITS (s2) steps).
# The app has already sliced the recordings and transcribed them into a .list file ("wav|speaker|lang|text").
# Prints "@voice {json}" progress lines: {"stage": "features"|"gpt"|"sovits", "progress": 0–1, "detail": "..."},
# then {"done": true, "gpt": path, "sovits": path}. Cancelling = killing this process group (the app does that).
# Training runs on the CPU on Macs: upstream notes that MPS-trained models come out noticeably worse.
import argparse, glob, json, os, re, subprocess, sys

def emit(message):
    sys.stdout.write('@voice ' + json.dumps(message, ensure_ascii=False) + '\n')
    sys.stdout.flush()

parser = argparse.ArgumentParser()
parser.add_argument('--src', required=True)        # GPT-SoVITS source folder (cwd for its scripts)
parser.add_argument('--list', required=True)       # transcript list
parser.add_argument('--wavs', required=True)       # folder with the sliced wavs
parser.add_argument('--work', required=True)       # experiment folder (temporary)
parser.add_argument('--out', required=True)        # where the final gpt.ckpt / sovits.pth go
parser.add_argument('--version', default='v2Pro')
parser.add_argument('--gpt-epochs', type=int, default=15)
parser.add_argument('--sovits-epochs', type=int, default=8)
parser.add_argument('--batch', type=int, default=4)
args = parser.parse_args()

src = os.path.abspath(args.src)
python = sys.executable
work = os.path.abspath(args.work)
exp = 'voice'
opt_dir = os.path.join(work, exp)
os.makedirs(opt_dir, exist_ok=True)
os.makedirs(args.out, exist_ok=True)
pre = os.path.join(src, 'GPT_SoVITS', 'pretrained_models')
version = args.version
s2config = os.path.join(src, 'GPT_SoVITS', 'configs', f's2{version}.json' if 'Pro' in version else 's2.json')
pretrained_s2G = os.path.join(pre, 'v2Pro', f's2G{version}.pth')
pretrained_s2D = os.path.join(pre, 'v2Pro', f's2D{version}.pth')
pretrained_s1 = os.path.join(pre, 's1v3.ckpt')
base_env = dict(os.environ, version=version, is_half='False', _CUDA_VISIBLE_DEVICES='0', i_part='0', all_parts='1',
                inp_text=os.path.abspath(args.list), inp_wav_dir=os.path.abspath(args.wavs), exp_name=exp, opt_dir=opt_dir,
                PYTHONPATH=os.pathsep.join([src, os.path.join(src, 'GPT_SoVITS')]), KMP_DUPLICATE_LIB_OK='TRUE', TEMP=os.path.join(work, 'TEMP'))

def step(script, extra, stage, start, end, detail, epochs=None):
    """Runs one upstream script; maps its 'Epoch N' lines onto [start, end] of the stage."""
    emit({'stage': stage, 'progress': start, 'detail': detail})
    extra = dict(extra)
    script_args = extra.pop('_args', [])
    env = dict(base_env, **extra)
    proc = subprocess.Popen([python, '-s', script] + script_args,
                            cwd=src, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    tail = []
    for line in proc.stdout:
        tail = (tail + [line.rstrip()])[-20:]
        if epochs:
            match = re.search(r'[Ee]poch[ :=]+(\d+)', line)
            if match:
                done = min(epochs, int(match.group(1)))
                emit({'stage': stage, 'progress': start + (end - start) * done / epochs, 'detail': f'{detail}：第 {done} / {epochs} 輪'})
    if proc.wait() != 0:
        raise RuntimeError(f'{os.path.basename(script)} failed: ' + ' | '.join(tail[-4:]))
    emit({'stage': stage, 'progress': end, 'detail': detail})

try:
    # 1a text → phonemes + BERT features, 1b audio → HuBERT features (+ speaker vectors for v2Pro), 1c semantic tokens
    step('GPT_SoVITS/prepare_datasets/1-get-text.py', {'bert_pretrained_dir': os.path.join(pre, 'chinese-roberta-wwm-ext-large')}, 'features', 0, .3, '整理文字')
    os.replace(os.path.join(opt_dir, '2-name2text-0.txt'), os.path.join(opt_dir, '2-name2text.txt'))
    step('GPT_SoVITS/prepare_datasets/2-get-hubert-wav32k.py', {'cnhubert_base_dir': os.path.join(pre, 'chinese-hubert-base')}, 'features', .3, .6, '分析聲音')
    if 'Pro' in version:
        step('GPT_SoVITS/prepare_datasets/2-get-sv.py', {'sv_path': os.path.join(pre, 'sv', 'pretrained_eres2netv2w24s4ep4.ckpt')}, 'features', .6, .75, '分析音色')
    step('GPT_SoVITS/prepare_datasets/3-get-semantic.py', {'pretrained_s2G': pretrained_s2G, 's2config_path': s2config}, 'features', .75, 1, '產生語音記號')
    with open(os.path.join(opt_dir, '6-name2semantic-0.tsv'), encoding='utf8') as f:
        rows = f.read().strip('\n')
    with open(os.path.join(opt_dir, '6-name2semantic.tsv'), 'w', encoding='utf8') as f:
        f.write('item_name\tsemantic_audio\n' + rows + '\n')

    # GPT (s1): text → semantic tokens
    import yaml
    gpt_dir = os.path.join(work, 'gpt_weights')
    os.makedirs(gpt_dir, exist_ok=True)
    with open(os.path.join(src, 'GPT_SoVITS', 'configs', 's1longer-v2.yaml')) as f:
        s1 = yaml.safe_load(f)
    s1['train'].update(precision='32', batch_size=max(1, args.batch), epochs=args.gpt_epochs, save_every_n_epoch=args.gpt_epochs,
                       if_save_every_weights=True, if_save_latest=True, if_dpo=False, half_weights_save_dir=gpt_dir, exp_name=exp)
    s1['data']['num_workers'] = 0
    s1.update(pretrained_s1=pretrained_s1, train_semantic_path=os.path.join(opt_dir, '6-name2semantic.tsv'),
              train_phoneme_path=os.path.join(opt_dir, '2-name2text.txt'), output_dir=os.path.join(opt_dir, f'logs_s1_{version}'))
    s1_path = os.path.join(work, 'tmp_s1.yaml')
    with open(s1_path, 'w') as f:
        yaml.dump(s1, f, default_flow_style=False)
    step('GPT_SoVITS/s1_train.py', {'hz': '25hz', '_args': ['--config_file', s1_path]}, 'gpt', 0, 1, '訓練 GPT', epochs=args.gpt_epochs)

    # SoVITS (s2): semantic tokens → waveform in this voice
    sovits_dir = os.path.join(work, 'sovits_weights')
    os.makedirs(sovits_dir, exist_ok=True)
    with open(s2config) as f:
        s2 = json.load(f)
    s2['train'].update(fp16_run=False, batch_size=max(1, args.batch // 2), epochs=args.sovits_epochs, text_low_lr_rate=0.4,
                       pretrained_s2G=pretrained_s2G, pretrained_s2D=pretrained_s2D, if_save_latest=True, if_save_every_weights=True,
                       save_every_epoch=args.sovits_epochs, gpu_numbers='0', grad_ckpt=False, lora_rank=32)
    s2['model']['version'] = version
    s2['data']['exp_dir'] = s2['s2_ckpt_dir'] = opt_dir
    s2.update(save_weight_dir=sovits_dir, name=exp, version=version)
    os.makedirs(os.path.join(opt_dir, f'logs_s2_{version}'), exist_ok=True)
    s2_path = os.path.join(work, 'tmp_s2.json')
    with open(s2_path, 'w') as f:
        json.dump(s2, f)
    step('GPT_SoVITS/s2_train.py', {'_args': ['--config', s2_path]}, 'sovits', 0, 1, '訓練 SoVITS', epochs=args.sovits_epochs)

    newest = lambda pattern: max(glob.glob(pattern), key=os.path.getmtime)
    gpt = newest(os.path.join(gpt_dir, '*.ckpt'))
    sovits = newest(os.path.join(sovits_dir, '*.pth'))
    os.replace(gpt, os.path.join(args.out, 'gpt.ckpt'))
    os.replace(sovits, os.path.join(args.out, 'sovits.pth'))
    emit({'done': True, 'gpt': os.path.join(args.out, 'gpt.ckpt'), 'sovits': os.path.join(args.out, 'sovits.pth')})
except Exception as error:
    emit({'fatal': f'{type(error).__name__}: {error}'})
    sys.exit(1)
