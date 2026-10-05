"""Owned interactive CLI terminal. No shell and no automatic permission answers."""
import base64, fcntl, json, os, pty, select, signal, struct, sys, termios, time

def emit(value):
    print(json.dumps(value), flush=True)

pid, master = pty.fork()
if pid == 0:
    os.environ['TERM'] = 'xterm-256color'
    os.execv(sys.argv[1], sys.argv[1:])
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 28, 100, 0, 0))
buffer = b''
emergency = False
try:
    while True:
        ready, _, _ = select.select([master, sys.stdin.buffer], [], [], 0.2)
        if master in ready:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            emit({'type': 'output', 'data': base64.b64encode(data).decode()})
        if sys.stdin.buffer in ready:
            data = os.read(sys.stdin.fileno(), 65536)
            if not data:
                break
            buffer += data
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                item = json.loads(line)
                if item['type'] == 'input':
                    os.write(master, base64.b64decode(item['data']))
                elif item['type'] == 'resize':
                    rows = max(10, min(100, int(item['rows'])))
                    cols = max(40, min(240, int(item['cols'])))
                    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
                elif item['type'] == 'stop':
                    break
                elif item['type'] == 'emergency':
                    emergency = True
                    os.write(master, b'\x03')
                    break
            else:
                continue
            break
finally:
    # Only this session's process group; never kill other Claude sessions.
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    os.close(master)
    try:
        deadline = time.monotonic() + (0.2 if emergency else 2)
        while True:
            reaped, status = os.waitpid(pid, os.WNOHANG)
            if reaped:
                break
            if time.monotonic() > deadline:
                os.killpg(pid, signal.SIGKILL)
                _, status = os.waitpid(pid, 0)
                break
            time.sleep(0.05)
        emit({'type': 'exit', 'code': os.waitstatus_to_exitcode(status)})
    except ChildProcessError:
        pass
