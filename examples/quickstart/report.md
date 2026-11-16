# Agent report

| Finding | Source |
|---|---|
| First station temperature | notes.md:5 "Water temperature was 14.2 °C at the first station." |
| Station 4 skipped on day 2 | notes.md:9 "Rain started before noon, so station 4 was skipped." |
| Lab shipment | notes.md:16 "All twelve bottles were shipped to the lab on Monday." |
| Cooler damage | notes.md:6 "Three samples were lost when the cooler lid cracked." |
| Weather log | weather.md:3 "Wind from the west, 20 km/h." |

Open items: `count(notes.md, "TODO") = 2`.
Bottles collected: `sum(samples.csv, bottles) = 13`.
Stations sampled on day 3: `rows(samples.csv, day=3) = 2`.

Files:
- [+] summary.md
