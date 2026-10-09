"""Uji opsional TCP -> broker EMQX -> WSS browser dengan payload sintetis.
Topic acak khusus uji, QoS0, retain=false. Tidak memerlukan ESP32.
"""
import functools
import argparse
import socket
import threading
import uuid
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright
from mqtt_packets import connect, publish, sample

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--host', default='broker.emqx.io')
parser.add_argument('--port', type=int, default=1883)
parser.add_argument('--url', default='wss://broker.emqx.io:8084/mqtt')
args = parser.parse_args()
nonce = uuid.uuid4().hex
device = 'exilir-c5-' + nonce[:12].upper()
topic = f'exilir/aiot/ch9-validation/{nonce}/{device}/telemetry'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        page = browser.new_page()
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.locator('#broker-url').fill(args.url)
        page.locator('#topic').fill(topic)
        page.locator('#connect').click()
        try:
            page.wait_for_function("document.getElementById('broker-status').textContent==='Tersambung'", timeout=30000)
        except Exception:
            print('Broker status:', page.locator('#broker-status').inner_text())
            print('Diagnostic:', page.locator('#message').inner_text())
            raise
        with socket.create_connection((args.host, args.port), timeout=10) as s:
            s.settimeout(10)
            s.sendall(connect('probe-' + nonce[:16]))
            ack = bytearray()
            while len(ack) < 4:
                chunk = s.recv(4 - len(ack))
                if not chunk:
                    raise RuntimeError('Broker closed before CONNACK')
                ack.extend(chunk)
            assert bytes(ack) == b'\x20\x02\x00\x00', ack
            s.sendall(publish(topic, sample(device_id=device, steps=321)))
            page.wait_for_function("document.getElementById('steps').textContent==='321'", timeout=15000)
            assert page.locator('#activity').inner_text() == 'Jalan'
            s.sendall(b'\xe0\x00')
        page.locator('#disconnect').click()
        browser.close()
finally:
    server.shutdown()
print(f'PASS: TCP {args.host}:{args.port} -> public broker -> {args.url}, synthetic payload, isolated topic, retain=false')
