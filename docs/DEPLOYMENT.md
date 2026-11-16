# LANTERN live preview

Public: https://issued-mood-bidding-publicity.trycloudflare.com/dashboard/index.html
Local on VPS: http://127.0.0.1:4186/dashboard/index.html
Served directory: /data/home/token-launch-radar/out/live
Server: python3 -m http.server 4186 --bind 127.0.0.1 --directory /data/home/token-launch-radar/out/live
Process session: proc_e02852450eaa; PID 3859200
Tunnel process session: proc_b6e4b2bd4433; PID 3859263
Tunnel: cloudflared tunnel --url http://127.0.0.1:4186 --no-autoupdate

Verified HTTPS 200, title LANTERN — Pre-token intelligence, loaded font, 3 model audit rows, readable 292px model column at 390px viewport, zero JavaScript page errors. Includes the upgraded production selection model, 64 conditional rank refits, stress calculator, per-protocol scenario saving/export, model-audit layout fix and ASCII animations. Quick tunnel is temporary and tied to running processes; not a permanent domain.

Rebuild served files with:
node main.ts --prepare --input /data/home/makefun-work/token-radar-01-kit/input/snapshot.json --output /data/home/token-launch-radar/out/live
