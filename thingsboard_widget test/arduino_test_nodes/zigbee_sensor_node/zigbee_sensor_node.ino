/*
 * DA2 Zigbee Sensor Node — ESP32-C6
 * Target board : ESP32-C6 (Arduino IDE: "ESP32C6 Dev Module")
 * Zigbee SDK   : ESP-Zigbee-SDK (esp-zigbee-lib, part of ESP-IDF / Arduino ESP32 ≥3.x)
 *
 * Role      : Zigbee End Device (ZED)
 * Clusters  :
 *   0x0000  Basic      (mandatory)
 *   0x0402  Temperature Measurement  — Attr 0x0000 MeasuredValue (int16, × 0.01 °C)
 *   0x0405  Relative Humidity        — Attr 0x0000 MeasuredValue (uint16, × 0.01 %)
 *
 * Behaviour:
 *   - Joins coordinator on any open channel (auto-scan)
 *   - Responds to ZCL Read Attribute requests for 0402/0000 and 0405/0000
 *   - Does NOT configure reporting (gateway polls explicitly)
 *   - Simulated sensor data (sine-wave, same formula as BLE node)
 *
 * NOTE: Requires ESP32 Arduino core ≥ 3.0.0 with Zigbee support enabled.
 *       In Arduino IDE: Tools → Zigbee mode → "Zigbee ED (end device)"
 */

#ifndef ZIGBEE_MODE_ED
#error "Select Zigbee End Device mode in Arduino IDE: Tools > Zigbee mode > ED"
#endif

#include "esp_zigbee_core.h"
#include "zboss_api.h"
#include <math.h>

/* ── Zigbee configuration ─────────────────────────────── */
#define DA2_ZB_ENDPOINT      0x0B   /* endpoint 11 decimal */
#define DA2_ZB_DEVICE_ID     0x0302 /* Temperature Sensor device ID */
#define DA2_ZB_CHANNEL_MASK  ESP_ZB_TRANSCEIVER_ALL_CHANNELS_MASK

/* ── Sensor simulation ────────────────────────────────── */
/* Temperature: 25.00 °C ± 2 °C (period 60 s), stored as int16 × 100 */
static int16_t sim_temp_raw(void) {
  float t   = (float)(millis()) / 1000.0f;
  float deg = 25.0f + 2.0f * sinf(2.0f * (float)M_PI * t / 60.0f);
  return (int16_t)(deg * 100.0f);
}

/* Humidity: 60.00 % ± 5 % (period 45 s), stored as uint16 × 100 */
static uint16_t sim_hum_raw(void) {
  float t   = (float)(millis()) / 1000.0f;
  float pct = 60.0f + 5.0f * sinf(2.0f * (float)M_PI * t / 45.0f);
  if (pct < 0.0f)   pct = 0.0f;
  if (pct > 100.0f) pct = 100.0f;
  return (uint16_t)(pct * 100.0f);
}

/* ── Zigbee attribute list builders ──────────────────── */

/* Basic cluster (0x0000) attributes */
static esp_zb_attribute_list_t* build_basic_cluster(void) {
  esp_zb_basic_cluster_cfg_t cfg = {
    .zcl_version   = ESP_ZB_ZCL_BASIC_ZCL_VERSION_DEFAULT_VALUE,
    .power_source  = 0x01  /* Mains single phase */
  };
  esp_zb_attribute_list_t* list = esp_zb_basic_cluster_create(&cfg);
  uint8_t  app_ver   = 0x01;
  uint8_t  stack_ver = 0x02;
  char     mfr[]     = "DA2";
  char     model[]   = "DA2_ZB_SENSOR";
  esp_zb_basic_cluster_add_attr(list, ESP_ZB_ZCL_ATTR_BASIC_APPLICATION_VERSION_ID, &app_ver);
  esp_zb_basic_cluster_add_attr(list, ESP_ZB_ZCL_ATTR_BASIC_STACK_VERSION_ID, &stack_ver);
  esp_zb_basic_cluster_add_attr(list, ESP_ZB_ZCL_ATTR_BASIC_MANUFACTURER_NAME_ID, mfr);
  esp_zb_basic_cluster_add_attr(list, ESP_ZB_ZCL_ATTR_BASIC_MODEL_IDENTIFIER_ID, model);
  return list;
}

/* Temperature Measurement cluster (0x0402) */
static esp_zb_attribute_list_t* build_temp_cluster(void) {
  esp_zb_temperature_meas_cluster_cfg_t cfg = {
    .measured_value     = 0x8000,  /* invalid initially */
    .min_value          = -4000,   /* -40.00 °C */
    .max_value          =  8500,   /* +85.00 °C */
  };
  return esp_zb_temperature_meas_cluster_create(&cfg);
}

/* Relative Humidity Measurement cluster (0x0405) */
static esp_zb_attribute_list_t* build_hum_cluster(void) {
  esp_zb_humidity_meas_cluster_cfg_t cfg = {
    .measured_value = 0,
    .min_value      = 0,
    .max_value      = 10000   /* 100.00 % */
  };
  return esp_zb_humidity_meas_cluster_create(&cfg);
}

/* ── Update simulated values in the Zigbee attribute database ─── */
static void update_sensor_attrs(void) {
  int16_t  t = sim_temp_raw();
  uint16_t h = sim_hum_raw();
  esp_zb_lock_acquire(portMAX_DELAY);
  esp_zb_zcl_set_attribute_val(DA2_ZB_ENDPOINT,
    ESP_ZB_ZCL_CLUSTER_ID_TEMP_MEASUREMENT,
    ESP_ZB_ZCL_CLUSTER_SERVER_ROLE,
    ESP_ZB_ZCL_ATTR_TEMP_MEASUREMENT_VALUE_ID,
    &t, false);
  esp_zb_zcl_set_attribute_val(DA2_ZB_ENDPOINT,
    ESP_ZB_ZCL_CLUSTER_ID_REL_HUMIDITY_MEASUREMENT,
    ESP_ZB_ZCL_CLUSTER_SERVER_ROLE,
    ESP_ZB_ZCL_ATTR_REL_HUMIDITY_MEASUREMENT_VALUE_ID,
    &h, false);
  esp_zb_lock_release();
  Serial.printf("[ZB] Attrs updated T=%.2f°C H=%.2f%%\n", t * 0.01f, h * 0.01f);
}

/* ── Zigbee signal handler ────────────────────────────── */
void esp_zb_app_signal_handler(esp_zb_app_signal_t *signal_s) {
  uint32_t *p = signal_s->p_app_signal;
  esp_err_t err = signal_s->esp_err_status;
  esp_zb_app_signal_type_t sig = *p;

  switch (sig) {
    case ESP_ZB_ZDO_SIGNAL_SKIP_STARTUP:
      Serial.println("[ZB] Stack ready — starting…");
      esp_zb_bdb_start_top_level_commissioning(ESP_ZB_BDB_MODE_INITIALIZATION);
      break;

    case ESP_ZB_BDB_SIGNAL_DEVICE_FIRST_START:
    case ESP_ZB_BDB_SIGNAL_DEVICE_REBOOT:
      if (err == ESP_OK) {
        Serial.println("[ZB] Device started — scanning for coordinator…");
        if (esp_zb_bdb_is_factory_new()) {
          esp_zb_bdb_start_top_level_commissioning(ESP_ZB_BDB_MODE_NETWORK_STEERING);
        } else {
          Serial.println("[ZB] Rejoining network…");
        }
      } else {
        Serial.printf("[ZB] Start failed (0x%x) — retrying\n", err);
        esp_zb_scheduler_alarm((esp_zb_callback_t)esp_zb_bdb_start_top_level_commissioning,
                               ESP_ZB_BDB_MODE_NETWORK_STEERING, 1000);
      }
      break;

    case ESP_ZB_BDB_SIGNAL_STEERING:
      if (err == ESP_OK) {
        esp_zb_ieee_addr_t ext;
        esp_zb_get_long_address(ext);
        Serial.printf("[ZB] Joined! IEEE=%02X:%02X:%02X:%02X:%02X:%02X:%02X:%02X\n",
          ext[7],ext[6],ext[5],ext[4],ext[3],ext[2],ext[1],ext[0]);
        update_sensor_attrs();
      } else {
        Serial.println("[ZB] Join failed — retrying in 5 s…");
        esp_zb_scheduler_alarm((esp_zb_callback_t)esp_zb_bdb_start_top_level_commissioning,
                               ESP_ZB_BDB_MODE_NETWORK_STEERING, 5000);
      }
      break;

    default:
      break;
  }
}

/* ── Zigbee task (runs in FreeRTOS task context) ─────── */
static void zigbee_task(void* arg) {
  /* Config as End Device */
  esp_zb_cfg_t zb_cfg = {
    .esp_zb_role           = ESP_ZB_DEVICE_TYPE_ED,
    .install_code_policy   = false,
    .nwk_cfg.zed_cfg = {
      .ed_timeout    = ESP_ZB_ED_AGING_TIMEOUT_64MIN,
      .keep_alive    = 3000   /* ms */
    }
  };
  esp_zb_init(&zb_cfg);

  /* ── Cluster lists ── */
  esp_zb_cluster_list_t* cl = esp_zb_zcl_cluster_list_create();
  esp_zb_cluster_list_add_basic_cluster(cl, build_basic_cluster(), ESP_ZB_ZCL_CLUSTER_SERVER_ROLE);
  esp_zb_cluster_list_add_temperature_meas_cluster(cl, build_temp_cluster(), ESP_ZB_ZCL_CLUSTER_SERVER_ROLE);
  esp_zb_cluster_list_add_humidity_meas_cluster(cl, build_hum_cluster(), ESP_ZB_ZCL_CLUSTER_SERVER_ROLE);

  /* ── Endpoint list ── */
  esp_zb_ep_list_t*  ep_list = esp_zb_ep_list_create();
  esp_zb_endpoint_config_t ep_cfg = {
    .endpoint        = DA2_ZB_ENDPOINT,
    .app_profile_id  = ESP_ZB_AF_HA_PROFILE_ID,
    .app_device_id   = DA2_ZB_DEVICE_ID,
    .app_device_version = 0
  };
  esp_zb_ep_list_add_ep(ep_list, cl, ep_cfg);
  esp_zb_device_register(ep_list);

  /* Channel + power */
  esp_zb_set_primary_network_channel_set(DA2_ZB_CHANNEL_MASK);
  esp_zb_set_tx_power(20);

  ESP_ERROR_CHECK(esp_zb_start(false));
  esp_zb_stack_main_loop();
}

/* ── Setup & Loop ─────────────────────────────────────── */
void setup() {
  Serial.begin(115200);
  Serial.println("[DA2] Zigbee Sensor Node booting…");

  /* Start Zigbee stack in its own task (required by ESP-IDF Zigbee) */
  xTaskCreate(zigbee_task, "zigbee_main", 4096, NULL, 5, NULL);
}

void loop() {
  /* Update simulated values every 5 s so READ Attr always returns fresh data */
  static uint32_t last = 0;
  if (millis() - last >= 5000) {
    last = millis();
    update_sensor_attrs();
  }
  delay(100);
}
