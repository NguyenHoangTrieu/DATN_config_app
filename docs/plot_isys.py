import re
import matplotlib.pyplot as plt
import os

log_file_path = "Log.md"

times = []
isys_values = []

# Regex pattern to match the log line and extract timestamp and Isys
# Example: I (318384) PWR_MON: Battery: SoC=96% Vbat=4163 mV I=0 mA | VSYS=4210 mV Isys=147 mA | Chrg=OFF
pattern = re.compile(r"I \((\d+)\) PWR_MON:.*Isys=(\d+) mA")

try:
    with open(log_file_path, 'r', encoding='utf-8') as f:
        for line in f:
            match = pattern.search(line)
            if match:
                # Convert time to seconds (assuming it's in milliseconds based on typical ESP-IDF logs)
                time_s = int(match.group(1)) / 1000.0
                isys_mA = int(match.group(2))
                
                times.append(time_s)
                isys_values.append(isys_mA)

    if not times:
        print("No Isys data found in the log file.")
    else:
        # Subtract initial time so plot starts from 0 (optional but helpful)
        first_time = times[0]
        relative_times = [t - first_time for t in times]

        plt.figure(figsize=(12, 6))
        plt.plot(relative_times, isys_values, linestyle='-', marker='o', markersize=2, color='b', alpha=0.7)
        plt.xlabel("Thời gian (giây)")
        plt.ylabel("Isys (mA)")
        plt.title("Dòng điện hệ thống (Isys) theo thời gian")
        plt.grid(True, linestyle='--', alpha=0.7)
        plt.tight_layout()
        plt.savefig("isys_plot.png", dpi=300)
        print("Successfully saved plot to isys_plot.png")
        plt.show()

except FileNotFoundError:
    print(f"Error: Could not find file {log_file_path} in current directory: {os.getcwd()}")
except Exception as e:
    print(f"An error occurred: {e}")
