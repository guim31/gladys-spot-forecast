# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-11-16

### Added

- A device for Finland with the forecast Nord Pool spot price of the current
  hour, the average, lowest and highest price of the next 24 hours and 7 days,
  the start and average price of the cheapest window of consecutive hours, and
  the date and end of the forecast (nordpool-predict-fi, VAT included).
- A dashboard widget with the forecast curve of the next 2, 4 or 7 days.
- Scene triggers: the cheapest forecast hours begin, the forecast price drops
  below a threshold.
- Scene action: find the cheapest forecast hours within a given time.
- A "Read the forecast now" action.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/guim31/gladys-spot-forecast/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-spot-forecast/releases/tag/v1.0.0
