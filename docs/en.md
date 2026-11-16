# Spot Price Forecast

Forecast spot electricity prices for the days **after** the published ones, to
plan the washing machine, the water heater or the car charging a week ahead.

The forecast comes from
[nordpool-predict-fi](https://github.com/vividfog/nordpool-predict-fi) by
vividfog (MIT license), an open machine-learning model that predicts the Nord
Pool **Finland** day-ahead prices hour by hour, about a week ahead, from weather
forecasts, wind power, nuclear availability and more.

Developed without a Finnish electricity contract to compare with: feedback
welcome. Not affiliated with Nord Pool nor with the author of the model.

## Overview

- One device, **Spot price forecast Finland**: the forecast price of the
  current hour, the average, lowest and highest price of the next 24 hours and
  of the next 7 days, the start and average price of the cheapest window of
  consecutive hours, when the forecast was updated and how far it goes.
- A dashboard widget: the forecast curve of the next 2, 4 or 7 days.
- Two scene triggers: the cheapest forecast hours begin, the forecast price
  drops below a threshold.
- One scene action: find the cheapest forecast hours within a given time.

Prices are in **€/kWh, Finnish VAT included** (the model's unit, euro cents,
divided by 100), without your supplier's margin nor the grid fees.

This is a **forecast**, not the published prices: Nord Pool publishes
tomorrow's real prices around 14:00 (Helsinki). For them, use a Nord Pool or
ENTSO-E integration next to this one.

## Requirements

- Gladys Assistant 5.3.0 or later.
- Internet access from Gladys: the forecast is a file on GitHub. No account,
  no key.

## Installation

1. In Gladys, open **Integrations → Install from GitHub**.
2. Enter `https://github.com/guim31/gladys-spot-forecast`.
3. Open the **Discovery** tab of the integration and add the device.
4. Add the **Spot price forecast** widget to a dashboard.

## Configuration

- **Length of the cheapest window** (1 to 8 hours, 3 by default) and **Search
  the cheapest window in** (the next 12 hours to 7 days, 24 hours by default):
  the window the device shows.
- **Language of the feature names** (French by default): used when the device
  is added; the names do not change afterwards.

## The forecast device

| Feature                                | Meaning                                                     |
| -------------------------------------- | ----------------------------------------------------------- |
| Forecast price now (€/kWh)             | the forecast price of the hour in progress                  |
| Average / Lowest / Highest next 24 h   | over the 24 hours from the current hour                     |
| Average / Lowest / Highest next 7 days | over the 168 hours from the current hour                    |
| Start of the cheapest window           | weekday and time (Helsinki), e.g. `Tue 03:00`               |
| Cheapest window average (€/kWh)        | the average forecast price of that window                   |
| Forecast updated / Forecast until      | when the model last published, and the end of its last hour |

Times are in the Helsinki time zone, the clock of the Finnish price hours.

## Dashboard widget

The forecast curve (one step per hour) of the next 2, 4 or 7 days, with its
lowest and highest hours marked; three tiles (now, average of the next 24 hours
and of the next 7 days); the cheapest window, the update time and the end of
the forecast. The tiles and the status lines can be hidden in the widget's
settings.

## Scene triggers

### Cheapest forecast hours begin

Fires when the cheapest run of N consecutive hours (1 to 8) of the next 12, 24
or 48 hours begins: nothing cheaper is forecast before that horizon. Then the
same choice stays silent until the horizon is over: with prices falling for a
whole day, the cheapest window would otherwise start "now" every hour.
Variables: average price, start and end (HH:MM).

### The forecast price drops below a threshold

Fires at the start of a run of hours under the threshold (0 to 0.20 €/kWh, VAT
included), when the hour before was above it. Variables: the price of the hour,
the number of hours under the threshold, start and end (HH:MM).

## Scene action

**Find the cheapest forecast hours**: the cheapest run of N consecutive hours
(1 to 8) from now, within the next 6 hours to 7 days. Outputs: found, starts
now, start date (YYYY-MM-DD), start and end (HH:MM), average price, minutes
until the start. With no forecast known (the source unreachable since the
start), the action fails in red.

## Scene examples

- **Water heater**: trigger "Cheapest forecast hours begin" (3 hours, nothing
  cheaper in the next 24 hours) → turn the water heater's plug on; a second
  scene turns it off three hours later.
- **Car charging**: every evening at 20:00, action "Find the cheapest forecast
  hours" (4 hours within 48 hours) → send a message "charge on
  {start_date} at {start_time}".
- **Negative prices**: trigger "The forecast price drops below a threshold"
  (0 €/kWh) → notify.

## Refresh and source usage

The file is read every 30 minutes with `If-None-Match`: when it has not
changed, GitHub answers 304 without content. When it changed, one call to the
GitHub API (60 calls an hour per address without token) gives the time of its
last commit; if GitHub refuses, the time the integration saw the change is
shown instead. After a failure, the next tries come after 5, 10, 20, 40 then 60
minutes; the last forecast read stays in use meanwhile. The model is rerun a
few times a day.

## Troubleshooting

- **The integration shows an error status**: the forecast cannot be read
  (GitHub unreachable), or it covers less than a day ahead (the model stopped
  publishing). The last forecast read stays in use.
- **No state on the device**: add the device from the Discovery tab, then use
  the **Read the forecast now** action.
- Full detail in the integration logs, with `LOG_LEVEL=debug`.

## Limitations

- **Finland only** for now: no open forecast without key was found for Sweden
  or Germany (November 2026). Other zones can be added as devices when one
  exists.
- A forecast is not a price: expect errors of several cents, more on windy or
  very cold days. The model's site shows its past accuracy.
- Hourly forecast, while the Nord Pool market trades in 15-minute periods
  since October 2025.
- The forecast depends on a hobby project hosted on GitHub: it may stop.
