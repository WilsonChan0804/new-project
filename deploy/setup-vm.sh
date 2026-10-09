#!/usr/bin/env bash
# 喺 VM 上面執行一次：bash ~/trip-app/deploy/setup-vm.sh
# 之後更新 App 檔案再執行一次都得（唔會郁你嘅資料 ~/trip-data）。
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$HOME/trip-data"
PORT="${TRIP_PORT:-8090}"
mkdir -p "$DATA"

echo "== 1. Python 套件（自動日文讀音）"
if ! python3 -c 'import venv, ensurepip' 2>/dev/null; then sudo apt-get update -qq && sudo apt-get install -y -qq python3-venv; fi
[ -d "$HOME/.trip-venv" ] || python3 -m venv "$HOME/.trip-venv"
"$HOME/.trip-venv/bin/pip" install -q --upgrade pykakasi

echo "== 2. 修改密碼"
if [ ! -f "$DATA/env" ]; then
  KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(9))')"
  printf 'TRIP_KEY=%s\nTRIP_DATA=%s\nTRIP_PORT=%s\n' "$KEY" "$DATA" "$PORT" > "$DATA/env"
  chmod 600 "$DATA/env"
fi

echo "== 3. 背景服務（開機自動行）"
sudo tee /etc/systemd/system/trip-app.service >/dev/null <<UNIT
[Unit]
Description=Trip planner app
After=network.target

[Service]
User=$USER
EnvironmentFile=$DATA/env
ExecStart=$HOME/.trip-venv/bin/python $APP/server/trip_server.py
Restart=always

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable -q trip-app
sudo systemctl restart trip-app
sleep 1
curl -fsS "http://127.0.0.1:$PORT/api/ping" >/dev/null && echo "伺服器 OK（port $PORT）"

echo "== 4. HTTPS（手機要 https 先可以離線用同定位）"
IP="$(curl -fsS -4 https://api.ipify.org || hostname -I | awk '{print $1}')"
# 用 trip. 開頭嘅獨立網址，唔會撞 LWK viewer 用緊嘅網址
HOST="${TRIP_DOMAIN:-trip.${IP//./-}.sslip.io}"
BLOCK="# trip-app（行程 App）
$HOST {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}"
CF=/etc/caddy/Caddyfile
if ! command -v caddy >/dev/null && sudo ss -ltnp | grep -qE ':(80|443) '; then
  echo "port 80/443 已經有其他程式用緊（唔係 Caddy）。請喺嗰度加一個 https 網站轉發去 http://127.0.0.1:$PORT"
elif command -v caddy >/dev/null && ! systemctl is-active -q caddy && sudo ss -ltnp | grep -qE ':(80|443) .*caddy'; then
  echo "Caddy 唔係用 systemd 行（可能係 LWK 自己開）。請將以下一段加入佢用緊嘅 Caddyfile，然後 caddy reload："
  echo "$BLOCK"
else
  if ! command -v caddy >/dev/null; then
    sudo apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    sudo apt-get update -qq && sudo apt-get install -y -qq caddy
  fi
  if ! sudo grep -q "^$HOST " "$CF" 2>/dev/null; then
    sudo cp "$CF" "$CF.bak-trip-$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
    if sudo grep -q '/usr/share/caddy' "$CF" 2>/dev/null; then
      echo "$BLOCK" | sudo tee "$CF" >/dev/null   # 全新安裝嘅示範設定，直接換走
    else
      # 保留原有內容（例如 LWK viewer），只係喺最尾加多一段
      printf '\n%s\n' "$BLOCK" | sudo tee -a "$CF" >/dev/null
    fi
    # 設定有錯就還原，唔會整壞 LWK viewer
    if ! sudo caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then
      BK="$(ls -t "$CF".bak-trip-* | head -1)"
      sudo cp "$BK" "$CF"
      echo "✗ Caddy 設定檢查唔過，已還原原本設定。請將 $CF 內容貼俾 Claude 睇。"
      exit 1
    fi
  fi
  sudo systemctl reload caddy
  echo
  echo "完成！手機 Safari 開： https://$HOST/"
fi
echo "修改密碼（每部要改資料嘅裝置輸入一次）：$(grep TRIP_KEY "$DATA/env" | cut -d= -f2)"
echo "（Azure 已經開咗 port 80 同 443，唔使再改。）"
