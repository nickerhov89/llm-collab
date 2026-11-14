import socket,time
for attempt in range(100):
 try:
  with socket.create_connection(('127.0.0.1',3456),timeout=.2):break
 except OSError:time.sleep(.05)
else:raise SystemExit('Employee broker did not become ready')
