import http.server
import socketserver
import webbrowser
import threading

PORT = 8000

Handler = http.server.SimpleHTTPRequestHandler

def start_server():
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"サーバーが起動しました: http://localhost:{PORT}/index.html")
        httpd.serve_forever()

# サーバーを別スレッドで実行
server_thread = threading.Thread(target=start_server)
server_thread.daemon = True
server_thread.start()

# 少し待ってからブラウザを開く（サーバー準備が完了する時間を確保）
import time
time.sleep(1)
webbrowser.open(f"http://localhost:{PORT}/index.html")

# メインスレッドを止めないように無限ループで待機
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    print("\nサーバーを停止します。")
