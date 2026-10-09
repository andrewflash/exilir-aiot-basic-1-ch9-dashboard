"""Packet kecil MQTT 3.1.1 untuk pengujian transport, tanpa dependency MQTT."""
import json
import struct


def string(value):
    data = value.encode('utf-8')
    return struct.pack('!H', len(data)) + data


def packet(header, body):
    remaining = len(body)
    encoded = bytearray()
    while True:
        digit = remaining % 128
        remaining //= 128
        encoded.append(digit | (128 if remaining else 0))
        if not remaining:
            return bytes([header]) + encoded + body


def connect(client_id):
    return packet(0x10, string('MQTT') + b'\x04\x02\x00\x1e' + string(client_id))


def publish(topic, data, retained=False):
    raw = data if isinstance(data, str) else json.dumps(data)
    return packet(0x31 if retained else 0x30, string(topic) + raw.encode())


def body_offset(data):
    index = 1
    while data[index] & 128:
        index += 1
    return index + 1


def sample(**changes):
    data = dict(schema=1, device_id='exilir-c5-001122334455', boot_id='TEST', seq=1, session=1,
                inference_seq=1, uptime_ms=12000, steps=20, activity='jalan', raw_label='jalan',
                confidence=.92, scores=dict(diam=.04, jalan=.92, lari=.04), inference_ms=14,
                dsp_ms=12, nn_ms=2, model_age_ms=0, state='stable', model_error=0, sample_gaps=0,
                sensor_errors=0, dropped_windows=0, firmware='9.1.0-mqtt')
    data.update(changes)
    return data
