# Spot Price Forecast for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration that
brings **forecast** Nord Pool spot electricity prices for the days after the
published ones (up to about a week ahead), to plan the washing machine, the
water heater or the car charging.

The forecast is the open model
[nordpool-predict-fi](https://github.com/vividfog/nordpool-predict-fi) by
vividfog: hourly prices for **Finland**, VAT included, without account or key.
It complements the integrations that read the published prices (Nord Pool,
ENTSO-E, EPEX Spot): here, only the forecast.

> Developed without a Finnish electricity contract to compare with: feedback
> welcome.

## Features

- One device per price zone (Finland for now): the forecast price of the
  current hour; average, lowest and highest price of the next 24 hours and of
  the next 7 days; start and average price of the cheapest window of N
  consecutive hours (configurable); when the forecast was updated and how far
  it goes.
- A dashboard widget: the forecast curve of the next 2, 4 or 7 days, with tiles
  and status lines that can be hidden.
- Scene triggers: _cheapest forecast hours begin_, _the forecast price drops
  below a threshold_.
- Scene action: _find the cheapest forecast hours_ within the next 6 hours to 7
  days.
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.3.0 or later.
- Internet access from Gladys (the forecast is a file on GitHub).

## Installation

In Gladys: **Integrations → Install from GitHub**, then enter
`https://github.com/guim31/gladys-spot-forecast`. Add the device from the
**Discovery** tab and the widget from a dashboard.

User documentation: [English](docs/en.md), [Français](docs/fr.md),
[Deutsch](docs/de.md), [Español](docs/es.md).

## How it works

The container reads `deploy/prediction.json` of nordpool-predict-fi every 30
minutes with `If-None-Match` (a 304 without content when it did not change),
and asks the GitHub API for the date of its last commit when it changed. Its
own minute timer publishes the states that changed (the core's poll is only a
fallback) and fires the scene triggers when an hour begins; the hours whose
events are out are kept in `/data/scene-events.json`, so a restart does not
fire them twice.

## Limitations

- Finland only: no open forecast without key was found for Sweden or Germany
  (November 2026). The code is ready for other zones (`src/source.js`).
- A forecast is not a price: errors of several cents are common.
- Hourly forecast, while Nord Pool trades in 15-minute periods since October 2025.
- Depends on a hobby project hosted on GitHub.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test, against the SDK's fake Gladys and a fake source
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store .   # store validator
```

See [`CLAUDE.md`](CLAUDE.md) for the architecture and the project rules.

## Credits

- Forecast: [nordpool-predict-fi](https://github.com/vividfog/nordpool-predict-fi)
  by vividfog (MIT license). The test fixture
  `test/fixtures/source/prediction-2026-11-16.json` is the real file of 16
  November 2026.
- The structure, triggers and widget come from
  [gladys-pvpc](https://github.com/guim31/gladys-pvpc).

## License

[Apache-2.0](LICENSE). Nord Pool is a trademark of its owner; this project is
not affiliated with Nord Pool nor with the author of nordpool-predict-fi.
