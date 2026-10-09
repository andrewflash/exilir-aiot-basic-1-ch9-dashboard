"""UI + MQTT wire tests memakai WebSocket terkontrol, tanpa board/broker publik.
Run: python Chapter_9/Dashboard/tests/test_dashboard.py
Requires Playwright + local Google Chrome.
"""
import functools
import json
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright
from mqtt_packets import sample, publish, body_offset

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.preview'
OUT.mkdir(exist_ok=True)
TOPIC = 'exilir/aiot/ch9/exilir-c5-001122334455/telemetry'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/'
checks = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        page = browser.new_page(viewport=dict(width=1360, height=960))
        errors, sockets, outgoing = [], [], []
        page.on('pageerror', lambda e: errors.append(str(e)))

        def route(ws):
            sockets.append(ws)

            def incoming(data):
                data = bytes(data)
                kind = data[0] >> 4
                outgoing.append(kind)
                if kind == 1:
                    ws.send(b'\x20\x02\x00\x00')
                elif kind == 8:
                    offset = body_offset(data)
                    ws.send(b'\x90\x03' + data[offset:offset + 2] + b'\x00')
                elif kind == 12:
                    ws.send(b'\xd0\x00')
            ws.on_message(incoming)

        page.route_web_socket('wss://broker.emqx.io:8084/mqtt', route)
        page.goto(url)
        assert page.locator('#steps').inner_text() == '—'
        page.locator('#demo').click()
        page.wait_for_function("document.getElementById('steps').textContent==='0'")
        assert page.locator('#broker-status').inner_text() == 'Demo lokal'
        assert not sockets
        page.wait_for_timeout(350)  # tunggu animasi bar selesai untuk preview
        page.screenshot(path=str(OUT / 'desktop.png'), full_page=True)
        checks.append('Demo lokal tanpa koneksi/publish broker')
        page.locator('#demo').click()
        page.wait_for_timeout(550)
        assert 'Simulasi' in page.locator('#data-mode').inner_text()
        assert page.locator('#device-status').inner_text() == 'Simulasi dijeda'

        page.locator('#topic').fill(TOPIC)
        page.locator('#connect').click()
        page.wait_for_function("document.getElementById('broker-status').textContent==='Tersambung'")
        assert page.locator('#steps').inner_text() == '—'
        sockets[-1].send(publish(TOPIC, sample()))
        page.wait_for_function("document.getElementById('steps').textContent==='20'")
        assert page.locator('#activity').inner_text() == 'Jalan'
        assert page.locator('#confidence').inner_text() == '92.0%'
        assert page.locator('#inference').inner_text() == '14 ms'
        assert page.locator('#bar-jalan').get_attribute('aria-valuenow') == '92.0'
        checks.append('Paho CONNECT/SUBSCRIBE dan JSON telemetry melalui MQTT WebSocket')

        sockets[-1].send(publish(TOPIC, sample(seq=2, steps=21)))
        page.wait_for_function("document.getElementById('steps').textContent==='21'")
        assert page.locator('#chart-caption').inner_text() == '1 hasil inference'
        sockets[-1].send(publish(TOPIC, sample(seq=1, steps=999)))
        page.wait_for_timeout(100)
        assert page.locator('#steps').inner_text() == '21'
        sockets[-1].send(publish(TOPIC, sample(seq=3, steps=999), retained=True))
        page.wait_for_timeout(100)
        assert page.locator('#steps').inner_text() == '21'
        checks.append('Tidak menggandakan titik per window; paket lama/retained diabaikan')

        sockets[-1].send(publish(TOPIC, '{bad json'))
        page.wait_for_function("document.getElementById('message').textContent.includes('Pesan diabaikan')")
        assert page.locator('#steps').inner_text() == '21'
        sockets[-1].send(publish(TOPIC, sample(seq=3, confidence=1.5)))
        page.wait_for_function("document.getElementById('message').textContent.includes('Confidence')")
        assert page.locator('#steps').inner_text() == '21'
        checks.append('JSON rusak / skor di luar rentang tidak mengganti data valid')

        sockets[-1].send(publish(TOPIC, sample(seq=4, steps=22, model_age_ms=8001)))
        page.wait_for_function("document.getElementById('steps').textContent==='22'")
        assert page.locator('#activity').inner_text() == 'Unknown'
        assert page.locator('#confidence').inner_text() == '—'
        checks.append('Hasil model lama disembunyikan, counter tetap terlihat')

        sockets[-1].send(publish(TOPIC, sample(seq=5, steps=23, firmware='<img src=x onerror=alert(1)>')))
        page.wait_for_function("document.getElementById('steps').textContent==='23'")
        assert '<img' in page.locator('#firmware').inner_text()
        assert page.locator('#firmware img').count() == 0
        page.evaluate('window.realNow = Date.now; Date.now = () => window.realNow() + 14000')
        page.wait_for_function("document.getElementById('device-status').textContent==='Data belum diperbarui'")
        assert page.locator('#confidence').inner_text() == '—'
        page.evaluate('Date.now = window.realNow')
        checks.append('Stale telemetry terdeteksi; string MQTT dirender sebagai teks')

        sockets[-1].send(publish(TOPIC, sample(boot_id='NEWBOOT', seq=1, steps=0, inference_seq=0, model_age_ms=None, state='calibrating')))
        page.wait_for_function("document.getElementById('steps').textContent==='0'")
        assert 'kalibrasi' in page.locator('#decision-note').inner_text()
        assert page.locator('#chart-caption').inner_text() == 'Belum ada hasil model'
        checks.append('Reboot / kalibrasi memulai riwayat sesi baru')

        sockets[-1].close(code=1001, reason='test reconnect')
        page.wait_for_function("document.getElementById('broker-status').textContent==='Menyambung ulang'")
        page.wait_for_function("document.getElementById('broker-status').textContent==='Tersambung'", timeout=12000)
        assert len(sockets) == 2
        page.locator('#disconnect').click()
        assert page.locator('#broker-status').inner_text() == 'Terputus'
        checks.append('Reconnect melakukan subscribe ulang; disconnect manual tersedia')

        page.locator('#topic').fill('exilir/#')
        page.locator('#connect').click()
        assert 'wildcard' in page.locator('#message').inner_text()
        page.locator('#topic').fill(TOPIC)
        page.set_viewport_size(dict(width=390, height=844))
        page.locator('#demo').click()
        page.wait_for_function("document.getElementById('broker-status').textContent==='Demo lokal'")
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.wait_for_timeout(350)
        page.screenshot(path=str(OUT / 'mobile.png'), full_page=True)
        checks.append('Topic spesifik diwajibkan; layout 390 px tanpa overflow')
        assert 3 not in outgoing, 'Dashboard must not publish MQTT data'
        assert not errors, errors
        browser.close()
finally:
    server.shutdown()
result = dict(status='PASS', transport='Controlled MQTT WebSocket; no ESP32 required', checks=checks)
(OUT / 'validation.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print('PASS:', '; '.join(checks))
