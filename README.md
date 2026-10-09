# Chapter 9 — Dashboard inference melalui MQTT

Contoh **HTML/CSS/JavaScript biasa**, tanpa framework, Node.js, atau server backend. ESP32-C5 menjalankan model Chapter 7, menghitung langkah, dan mengirim JSON melalui broker MQTT publik. Browser berlangganan topic yang sama menggunakan MQTT melalui WebSocket.

```text
MPU6050 → ESP32-C5: detector langkah + model TinyML
                            │ publish JSON, TCP 1883
                     broker.emqx.io
                            │ subscribe, WSS 8084 /mqtt
                     dashboard browser
```

## Coba tampilan

Buka **[index.html](index.html)** di browser, lalu klik **Coba demo**. Demo memakai data sintetis lokal dan tidak terhubung atau mengirim pesan ke broker. Library MQTT sudah disertakan di `vendor/`, sehingga demo tidak perlu internet.

File yang dapat diedit:

| File | Fungsi |
| --- | --- |
| [index.html](index.html) | Struktur halaman dan pengaturan koneksi |
| [styles.css](styles.css) | Warna, kartu, tabel dan layout responsif |
| [app.js](app.js) | MQTT, parsing JSON, pembaruan tampilan, grafik dan demo |
| [../Code/Step_Counter_MQTT/](../Code/Step_Counter_MQTT/) | Sketch ESP32-C5 pengirim hasil inference |

## Jalankan dengan ESP32

1. Buka **[Step_Counter_MQTT.ino](../Code/Step_Counter_MQTT/Step_Counter_MQTT.ino)**. Semua header pada folder sketch harus tetap bersama file `.ino`.
2. Ikuti [persiapan sketch](../Code/Step_Counter_MQTT/README.md), install library, kemudian isi `WIFI_SSID` dan `WIFI_PASSWORD` di **[Config.h](../Code/Step_Counter_MQTT/Config.h)**. Pilih board **DFRobot FireBeetle 2 ESP32-C5** dan upload lewat USB.
3. Buka Serial Monitor **115200 baud**. Salin nilai setelah `# TOPIC=`. Contoh format:

   ```text
   # DEVICE_ID=exilir-c5-001122334455
   # TOPIC=exilir/aiot/ch9/exilir-c5-001122334455/telemetry
   ```

   ID di atas hanya contoh. Sketch membuat ID otomatis dari MAC board; gunakan topic yang dicetak board Anda, tanpa teks `# TOPIC=`. Setiap peserta memiliki topic berbeda.

4. Buka `index.html`, masukkan topic tersebut dan klik **Hubungkan**. Biarkan URL broker default `wss://broker.emqx.io:8084/mqtt`.
5. Pada Serial Monitor kirim **`r`**, diam **3 detik** untuk kalibrasi, lalu lakukan aktivitas diam/jalan/lari. Counter mulai setelah kalibrasi. Aktivitas stabil memerlukan tiga window model; kira-kira 9 detik sejak reset ditambah pemrosesan.

Laptop/browser dan ESP32 membutuhkan akses internet ke broker; tidak harus berada pada LAN yang sama. Dashboard menyimpan URL dan topic pada browser agar tidak perlu mengetik ulang, tetapi tidak otomatis menyambung ketika halaman dibuka.

Jika browser membatasi pembukaan file lokal, jalankan dari root workspace:

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory Chapter_9/Dashboard
```

Lalu buka **http://localhost:8000**. Hentikan server dengan `Ctrl+C`.

## Broker publik

Default memakai [broker publik EMQX](https://www.emqx.com/en/mqtt/public-mqtt5-broker), tanpa akun/username/password.

| Klien | Alamat | Transport |
| --- | --- | --- |
| Arduino | `broker.emqx.io:1883` | MQTT TCP, tanpa TLS |
| Browser | `wss://broker.emqx.io:8084/mqtt` | MQTT melalui WebSocket dengan TLS |

Port browser berbeda dari Arduino karena browser tidak membuka koneksi TCP MQTT langsung. Topic pada kedua klien harus sama persis. Client ID browser dibuat acak dan berbeda dari ID Arduino.

Broker ini terbuka: siapa pun dapat membaca maupun mengirim pesan ke topic yang sama. Gunakan data latihan tanpa informasi sensitif. Topic per board mengurangi bentrok peserta, tetapi tidak menyediakan autentikasi. Jalur Arduino pada contoh ini tidak dienkripsi; WSS hanya melindungi jalur browser.

Jika broker atau port tidak tersedia, cek internet, firewall, dan [status layanan EMQX](https://www.emqx.com/en/mqtt/public-mqtt5-broker). Alternatif EMQX untuk halaman lokal/HTTP adalah `ws://broker.emqx.io:8083/mqtt` (tanpa TLS); halaman HTTPS harus memakai WSS. Anda juga dapat mengganti broker di `Config.h` dan URL dashboard dengan pasangan TCP/WebSocket dari broker lain. Ganti **keduanya**, kemudian compile dan upload ulang.

## Data yang ditampilkan

- Jumlah langkah, aktivitas stabil **diam/jalan/lari/unknown**, confidence prediksi mentah dan waktu DSP + neural network.
- Tiga skor kelas dan grafik maksimal 40 hasil inference, satu titik per hasil model baru.
- 12 pesan terakhir, uptime, usia model, gap sampling, error sensor/model dan window model yang terlewat.
- JSON terakhir untuk belajar format payload dan debugging.

Aktivitas stabil mengikuti voting di ESP32: confidence **>0,80**, mayoritas minimal **2 dari 3** window. Confidence pada kartu adalah skor **prediksi mentah terbaru**, sehingga label raw dapat berbeda dari aktivitas stabil. Counting diproses terpisah; satu prediksi jalan tidak berarti satu langkah.

Arduino mengirim snapshot sekitar **1 kali/detik**; model menerima 100 sampel pada 50 Hz (~2 detik/window), sehingga beberapa pesan bisa memuat hasil inference yang sama. Pengiriman **QoS 0**, **retain=false**, tanpa replay/history pada broker. Jika koneksi terputus, snapshot lama diganti oleh snapshot terbaru; jumlah langkah pada perangkat tetap diteruskan.

Hasil model berusia >7 detik disembunyikan menjadi unknown; tidak ada pesan >12 detik menandai data belum diperbarui. Dashboard mempertahankan hitungan terakhir sebagai referensi. Reset `r` atau reboot memulai riwayat sesi baru. Hitungan di ESP32 hanya disimpan di RAM.

## Format JSON

Payload lengkap harus mengikuti schema 1 pada **[payload.example.json](payload.example.json)**. Field inti:

| Field | Isi |
| --- | --- |
| `device_id`, `boot_id` | Identitas board dan boot |
| `seq`, `session`, `inference_seq` | Urutan telemetry, sesi kalibrasi dan hasil model |
| `steps`, `activity` | Hitungan dan label hasil voting |
| `raw_label`, `confidence`, `scores` | Prediksi terbaru dan skor 0–1 setiap kelas |
| `model_age_ms` | Usia hasil model, atau `null` sebelum hasil pertama |
| `inference_ms`, `dsp_ms`, `nn_ms` | Waktu komputasi dalam ms |
| `state`, `model_error` | Status perangkat dan kode error inference |
| `sample_gaps`, `sensor_errors`, `dropped_windows` | Diagnostik sampling dan model |

Pesan JSON rusak, schema/label tidak dikenal atau nilai skor di luar 0–1 ditolak. Pesan retained dan urutan lama pada boot yang sama diabaikan. Dashboard hanya melakukan subscribe; tombol demo dan putuskan tidak mengirim perintah ke board.

## Debug cepat

| Gejala | Periksa |
| --- | --- |
| Broker belum terhubung | URL WebSocket, internet dan akses port 8084; cek pesan pada halaman |
| Tersambung, belum ada data | Arduino sudah Wi-Fi/MQTT tersambung; topic sama persis dengan Serial |
| `unknown` pada awal sesi | Tunggu kalibrasi dan tiga window model; amati confidence raw |
| `sensor_error` | MPU6050, GPIO2/3, alamat 0x68, tegangan dan GND |
| `calibration_failed` | Perbaiki sensor/timing; kirim `r` dan diam 3 detik |
| Data belum diperbarui | Board mati/reboot atau jaringan terputus; broker terhubung belum membuktikan board mengirim |
| Gap sampling meningkat | Kurangi logging/Plotter dan periksa beban jaringan/model di hardware |

Uji compile, browser dan batas pengujian dicatat pada **[VALIDASI.md](VALIDASI.md)**. Belum ada pengujian kit fisik.
