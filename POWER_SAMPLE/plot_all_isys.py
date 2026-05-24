import os
import re
import matplotlib.pyplot as plt

# Từ điển ánh xạ tên và file (Đã bỏ ZIGBEE)
files = {
    'Plot A': 'PLOT_A.md',
    'Plot B': 'PLOT_B.md'
}

data = {}
publish_events = {'Plot A': []}

# Biểu thức chính quy (Regex) lấy Timestamp, VSYS và Isys
pattern = re.compile(r'I \((\d+)\) PWR_MON:.*VSYS=(\d+) mV.*Isys=(\d+) mA')
# Regex lấy thời điểm publish
pattern_pub = re.compile(r'I \((\d+)\) mqtt_handler: ✓ Published')

for label, filepath in files.items():
    times = []
    power_w = []
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            for line in f:
                match = pattern.search(line)
                if match:
                    times.append(int(match.group(1)))
                    vsys_mv = int(match.group(2))
                    isys_ma = int(match.group(3))
                    power_w.append(vsys_mv * isys_ma / 1_000_000)
                
                # Bắt thời điểm publish (chỉ có ở Plot A)
                if label == 'Plot A':
                    pub_match = pattern_pub.search(line)
                    if pub_match:
                        publish_events['Plot A'].append(int(pub_match.group(1)))
    except Exception as e:
        print(f"Lỗi khi đọc file {filepath}: {e}")
    
    if times:
        first_time = times[0]
        # Thời gian tính bằng mili-giây, chuẩn hóa mốc 0
        rel_times = [t - first_time for t in times]
        data[label] = (rel_times, power_w)
        
        # Chuẩn hóa thời gian cho các sự kiện publish
        if label == 'Plot A' and publish_events['Plot A']:
            publish_events['Plot A'] = [t - first_time for t in publish_events['Plot A']]

print("Đã đọc xong dữ liệu. Đang tạo đồ thị để hiển thị...")

# --- Cửa sổ 1: Đồ thị riêng lẻ từng loại ---
fig1, axes1 = plt.subplots(2, 1, figsize=(12, 6), sharex=True)
fig1.canvas.manager.set_window_title("Đồ thị riêng lẻ")
keys = list(data.keys())
for idx, label in enumerate(keys):
    axes1[idx].plot(data[label][0], data[label][1], label=label, linewidth=1, color=f"C{idx}")
    
    # Vẽ đánh dấu sự kiện publish trên đồ thị Plot A
    if label == 'Plot A' and publish_events['Plot A']:
        for pt in publish_events['Plot A']:
            axes1[idx].axvline(x=pt, color='red', linestyle='--', alpha=0.6, linewidth=1)
        # Thêm 1 vline ẩn vào legend để có chú thích
        axes1[idx].axvline(x=-1000, color='red', linestyle='--', label='MQTT Publish')
        
    avg = sum(data[label][1]) / len(data[label][1])
    axes1[idx].axhline(y=avg, color=f"C{idx}", linestyle=':', linewidth=1.5, label=f'TB: {avg:.3f} W')
    axes1[idx].set_ylabel('Công suất (W)')
    axes1[idx].legend(loc="upper right")
    axes1[idx].grid(True)
axes1[-1].set_xlabel('Thời gian (ms)')
fig1.suptitle("Công suất tiêu thụ riêng lẻ (Sample 10ms)")
fig1.tight_layout()

# --- Cửa sổ 2: Đồ thị so sánh (Tất cả dữ liệu) ---
fig2 = plt.figure(figsize=(12, 6))
fig2.canvas.manager.set_window_title("So sánh tất cả dữ liệu")
for idx, label in enumerate(keys):
    plt.plot(data[label][0], data[label][1], label=label, linewidth=1, alpha=0.8, color=f"C{idx}")
    avg = sum(data[label][1]) / len(data[label][1])
    plt.axhline(y=avg, color=f"C{idx}", linestyle=':', linewidth=1.5, label=f'{label} TB: {avg:.3f} W')

# Vẽ đánh dấu sự kiện publish trên đồ thị chung
if publish_events.get('Plot A'):
    for pt in publish_events['Plot A']:
        plt.axvline(x=pt, color='red', linestyle='--', alpha=0.6, linewidth=1)
    plt.axvline(x=-1000, color='red', linestyle='--', label='Plot A MQTT Publish')
plt.xlabel('Thời gian (ms)')
plt.ylabel('Công suất (W)')
plt.title('Công suất tiêu thụ - Plot A vs Plot B (Sample 10ms)')
plt.legend(loc="upper right")
plt.grid(True)
fig2.tight_layout()

# Hiển thị tất cả cửa sổ để bạn có thể tương tác (Zoom, Pan, Save)
plt.show()
