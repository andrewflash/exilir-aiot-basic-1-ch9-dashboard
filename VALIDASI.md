# Validasi dashboard dan MQTT — 9 Oktober 2026

## Compile Arduino

**PASS**, exit 0, untuk `Chapter_9/Code/Step_Counter_MQTT`:

- Arduino CLI 1.5.1; ESP32 core **3.3.11**.
- Board **`esp32:esp32:dfrobot_firebeetle2_esp32c5`**, partisi default 4 MB.
- Library model dipilih langsung dari ekspor Chapter 7 melalui `--library`.
- PubSubClient **2.8**, ArduinoJson **7.4.3**, Adafruit MPU6050 **2.2.9**, NeoPixel **1.15.5**.
- Flash **1.205.949 byte / 1.310.720 byte (92%)**.
- Global **55.376 byte / 327.680 byte (16%)**. Angka ini bukan peak RAM runtime; stack worker model 16.384 byte dan worker jaringan 8.192 byte dialokasikan saat runtime.

Perintah compile standar tersedia pada [README sketch](../Code/Step_Counter_MQTT/README.md). Kredensial di source kosong; compile tidak menguji Wi-Fi pada board. Versi MQTT tidak menyertakan OLED/OTA.

## Uji browser dan protokol

**PASS** pada Google Chrome headless melalui Playwright, dengan server HTTP localhost. Broker digantikan oleh WebSocket terkontrol yang menerima packet MQTT CONNECT/SUBSCRIBE/PINGREQ dan mengirim CONNACK/SUBACK/PUBLISH/PINGRESP. Uji ini menggunakan library Paho asli, tetapi tidak memerlukan board atau broker eksternal.

- Demo berjalan tanpa membuka WebSocket atau publish ke broker. Demo yang dihentikan tetap ditandai sebagai simulasi.
- JSON telemetry diterima melalui MQTT WebSocket; jumlah langkah, label, confidence, skor dan timing ditampilkan.
- Telemetry berulang dari window model yang sama tidak menggandakan titik grafik.
- Paket urutan lama pada boot yang sama dan pesan retained diabaikan.
- JSON rusak atau confidence di luar rentang ditolak tanpa menimpa data valid.
- Hasil model >7 detik menjadi unknown; counter terakhir tetap tampil.
- Tanpa telemetry >12 detik muncul penanda data belum diperbarui.
- String dari MQTT dirender sebagai teks, bukan HTML.
- Reboot/kalibrasi memulai riwayat baru.
- Koneksi terputus diikuti retry dan subscribe ulang; putuskan manual tersedia.
- Topic wildcard ditolak. Layout **1360 px** dan **390 px** diperiksa; layar ponsel tidak memiliki overflow horizontal.
- Browser tidak pernah mengirim packet MQTT PUBLISH. Tidak ada error JavaScript pada uji.

`node --check Chapter_9/Dashboard/app.js` juga berhasil. Bukti uji dan preview: [.preview/validation.json](.preview/validation.json), [desktop.png](.preview/desktop.png), [mobile.png](.preview/mobile.png).

Menjalankan ulang uji UI (opsional; dashboard tidak membutuhkan Python/Playwright):

```powershell
python -m pip install playwright
python Chapter_9/Dashboard/tests/test_dashboard.py
```

Script memakai Google Chrome yang terpasang melalui `channel='chrome'`.

## Broker eksternal

Konfigurasi port diverifikasi dari [halaman resmi broker EMQX](https://www.emqx.com/en/mqtt/public-mqtt5-broker): TCP **1883** dan WSS **8084**, path `/mqtt`.

- Koneksi TCP ke `broker.emqx.io:1883` menerima CONNACK sukses `20 02 00 00` menggunakan MQTT 3.1.1 dengan client ID unik. Uji ini hanya connect/disconnect, tanpa data perangkat.
- **Uji round-trip publik belum lulus**: koneksi WSS dari browser mengalami timeout pada lingkungan ini. Probe TLS langsung ke port 8084 juga timeout, sehingga penerimaan JSON dari broker publik nyata belum terbukti. Penyebab eksternal belum dipastikan.
- Uji browser terkontrol di atas membuktikan parsing dan alur MQTT aplikasi, tetapi tidak membuktikan ketersediaan broker publik atau akses jaringan peserta.

Uji end-to-end opsional menggunakan payload sintetis di topic acak terpisah:

```powershell
python Chapter_9/Dashboard/tests/test_public_mqtt.py
```

Script mencoba TCP publisher → broker EMQX nyata → WSS dashboard. Payload memakai QoS 0 dan retain=false. Script tidak memakai ESP32 dan tidak mengirim data pribadi. Gunakan `--host`, `--port`, dan `--url` jika ingin menguji pasangan endpoint broker lain.

## Batas pengujian

Belum upload ke ESP32 atau menguji sensor fisik. Akurasi model/counting, kalibrasi, sampling/jitter saat Wi-Fi reconnect, runtime heap/stack, RGB/buzzer dan publish dari board memerlukan uji kit. Snapshot jaringan berada pada task terpisah, tetapi worker berbagi CPU dengan sampling/inference pada ESP32-C5.

Broker publik dapat restart, lambat atau tidak tersedia; contoh memiliki retry tanpa jaminan pengiriman QoS 0. Topic unik mengurangi bentrok, bukan autentikasi. Dashboard bukan penyimpanan riwayat permanen; data hilang saat reload, sedangkan count board hilang saat reboot.
