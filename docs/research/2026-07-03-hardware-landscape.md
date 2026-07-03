# GHOST GCS — Hardware Landscape Research

**Date:** 2026-07-03 · **Method:** deep-research workflow (104 agents; adversarial 3-vote verification per claim)

## Executive summary

The hardware-free path is fully proven and should come first: ArduPilot SITL requires no flight controller, supports Copter and Rover, and speaks MAVLink v2 over TCP/UDP — GHOST GCS can be developed and tested entirely in simulation (optionally with Gazebo Garden/Harmonic) before any purchase, which matters because Kuwait's CITRA controls customs release of ALL imported RF/communications gear, requires an import license plus technical specs for clearance, and can bar non-compliant shipments (SiK telemetry radios, RC links) at the border. For the rover phase, ArduPilot Rover is a first-class platform running on a wide documented board list, with MAVLink-speaking autopilots starting around $25-45 and the Pixhawk 6C at $165.99; for a drone, the Holybro X500 V2 kit (Pixhawk 6C + 915/433MHz SiK radio, ~$533-585, PX4 preloaded / ArduPilot-flashable, ~30-min no-solder assembly) is the reference MAVLink DIY build, and the ModalAI Starling 2 is a turnkey RTF PX4/MAVLink development drone. DJI is a dead end for a native MAVLink GCS: no DJI drone speaks MAVLink natively; MSDK v5 is Android-only and covers only enterprise models plus Mini 3/Mini 3 Pro/Mini 4 Pro, while the open-source RosettaDrone MAVLink bridge works but is frozen on the deprecated MSDK v4 (older Mini/Mavic/Air generation) and is experimental. Recommendation: simulate now, build the rover with a budget ArduPilot board sourced with CITRA type-approval in mind, and treat the drone phase as contingent on unresolved Kuwait DGCA flight-authorization rules — which this research verified only on the import/RF side, not the flying side.

## Verified findings (9)

### 1. Kuwait import barrier is real and RF-specific: CITRA controls customs release of ALL imported communications d…

- **Confidence:** high · **Vote:** 3-0 (x3 merged claims)
- **Claim:** Kuwait import barrier is real and RF-specific: CITRA controls customs release of ALL imported communications devices (via offices at Kuwait Airport, Shuwaikh, Sulaibya, and Shuaiba ports), requires a documented clearance application including an import license and technical specifications, and has explicit authority to bar non-compliant shipments from entering the country. Drone RF gear — SiK 915MHz telemetry radios, RC transmitters/receivers, video links — therefore faces CITRA type-approval/clearance, not just standard customs, and a hobbyist mail-ordering a telemetry radio or RTF kit without an import license risks the shipment being held or barred. The clearance pathway is company-oriented ('authorized signature for companies'), and multiple type-approval consultancies confirm approval must be secured before shipment arrival.
- **Evidence:** CITRA's own service page states verbatim: 'CITRA is responsible for releasing all communications devices, in addition to granting re-export permits' and 'CITRA is also responsible for barring non-compliant shipments from entering the country.' Required documentation listed: application form, invoice copy, bill of lading, authorized company signature, technical specifications, and import license. Five independent type-approval consultancies corroborate mandatory pre-arrival approval for all wireless/RF equipment; drone-law sources note drone import without approval is prohibited and devices can be seized. Verified live 2026-07-03; merged from three unanimously-confirmed claims (all 3-0).
- **Sources:**
  - https://www.citra.gov.kw/sites/en/Pages/ServiceDetails.aspx?SrvcID=119
  - https://cetecomadvanced.com/en/country-approval/kuwait/
  - https://www.csagroup.org/global-certification-regulatory-update/kuwait-citra-announces-new-regulation-for-type-approval-of-telecoms-equipment/
  - https://www.nanotechsol.com/post/kuwait-citra-type-approval-complete-regulatory-guide

### 2. The Holybro X500 V2 kit is the reference MAVLink-capable DIY quad: sold as a PX4 Development Kit in four varia…

- **Confidence:** high · **Vote:** 3-0 (x3 merged claims)
- **Claim:** The Holybro X500 V2 kit is the reference MAVLink-capable DIY quad: sold as a PX4 Development Kit in four variants at $532.99 (Pixhawk 6C) or $654.99 (Pixhawk 6X), each pairing an M10 GPS with a 433MHz or 915MHz SiK Telemetry Radio V3; a reseller Full Kit variant (Pixhawk 6C + 915MHz) lists at $584.99 at NewBeeDrone, giving a market range of roughly $533-585. Contents: full carbon-fiber X500 V2 frame (144x144mm plates), four Holybro 2216 KV920 motors, four BLHeli_S 20A ESCs, 1045 props; arms come pre-installed with motors and ESCs so assembly takes ~30 minutes with no soldering. CAVEAT: at verification time all variants were listed SOLD OUT at both Holybro direct and NewBeeDrone — these are list prices, not purchasable-today prices.
- **Evidence:** Live fetch of Holybro's store (2026-07-03) confirms exactly four variants — 6C/M10/433, 6C/M10/915 at $532.99; 6X/M10/433, 6X/M10/915 at $654.99 — and kit contents verbatim ('SiK Telemetry Radio V3 433/915MHz', 'minimal assembly time (~30 minutes), No soldering required', 'Drone Arms are pre-installed with Motors and ESCs'). NewBeeDrone listing confirmed at $584.99 with matching contents. Merged from three unanimously-confirmed pricing/contents claims (all 3-0). Sold-out status flagged by verifiers on both storefronts.
- **Sources:**
  - https://holybro.com/products/px4-development-kit-x500-v2
  - https://newbeedrone.com/products/holybro-x500-v2-full-kit-pixhawk-6c915mhz-telemetry-radio
  - https://docs.holybro.com/drone-development-kit/px4-development-kit-x500v2

### 3. The Pixhawk 6C (and the X500 kits built on it) ships with PX4 preinstalled and is fully ArduPilot-compatible (…

- **Confidence:** high · **Vote:** 3-0 (x3 merged claims)
- **Claim:** The Pixhawk 6C (and the X500 kits built on it) ships with PX4 preinstalled and is fully ArduPilot-compatible (supported since ArduPilot 4.2.3; the M10 GPS variant needs PX4 1.14 / ArduPilot 4.3+; the 6X's PM02D HV power module needs ArduPilot 4.4+), so it natively speaks MAVLink v2 and works out-of-the-box with a custom GCS like GHOST for both Copter and Rover builds. Standalone Pixhawk 6C pricing: eight variants from $165.99 (plastic case, no power module) to $219.98 (aluminum + PM07), a realistic anchor for the mid-tier flight-controller budget line.
- **Evidence:** Holybro product pages state verbatim 'compatible with both PX4 & Ardupilot, but shipped with PX4', 'M10 GPS Requires PX4 1.14 & ArduPilot 4.3 or newer', and PM02D-HV 'only supported in Ardupilot 4.4 & later'. ArduPilot official docs carry dedicated Pixhawk 6C hardware pages under both Copter and Rover with firmware builds on firmware.ardupilot.org. All 8 price variants verified live on Holybro's storefront (2026-07-03): plastic/none $165.99 through aluminum/PM07 $219.98. Merged from three unanimously-confirmed claims (all 3-0). Note verifier caveat: 'out-of-the-box' applies to GCS/MAVLink connectivity, not flight-readiness (assembly + calibration still required; ArduPilot requires user flashing).
- **Sources:**
  - https://holybro.com/products/pixhawk-6c
  - https://holybro.com/products/px4-development-kit-x500-v2
  - https://ardupilot.org/rover/docs/common-holybro-pixhawk6C.html
  - https://newbeedrone.com/products/holybro-x500-v2-full-kit-pixhawk-6c915mhz-telemetry-radio

### 4. ArduPilot Rover is a first-class platform for the GHOST GCS rover phase: the official firmware supports conven…

- **Confidence:** high · **Vote:** 3-0 (x3 merged claims)
- **Claim:** ArduPilot Rover is a first-class platform for the GHOST GCS rover phase: the official firmware supports conventional 3-4 wheel rovers plus boats, sailboats, balance bots, and walking robots, and runs on a wide documented list of autopilot boards (dedicated 'Choosing an Autopilot' docs section covering Pixhawk 6C/6X, Cube Orange/+, Matek F405 TE / H743, Holybro Durandal/Kakute, and many others) — no single mandated board. ArduPilot-compatible flight controller prices start around $25 (docs' figure; cheapest in-stock boards today cluster ~$30-45, e.g. SpeedyBee F405 Wing at ~$40), so a MAVLink-speaking rover autopilot can be sourced far below Pixhawk 6X / Cube Orange+ levels.
- **Evidence:** Official ArduPilot Rover docs verified verbatim: 'Rover is a sophisticated open-source firmware, specially designed for autopilots in ground and water vehicles... supports not only conventional 3 or 4 wheel configurations, but also extends to boats, sailboats, balance bots, and walking robots' and 'Rover is compatible with a wide variety of supported autopilot boards.' Autopilot docs state 'Controller prices range from ~$25 to much more, depending on feature set,' corroborated by live retail prices (SpeedyBee F405 Wing $39.99 official store). Merged from three unanimously-confirmed claims (all 3-0). Minor nit: rover.ardupilot.org has a TLS cert mismatch; canonical URL is ardupilot.org/rover.
- **Sources:**
  - https://ardupilot.org/rover/
  - https://ardupilot.org/rover/docs/common-autopilots.html
  - https://ardupilot.org/copter/docs/common-autopilots.html

### 5. DJI-to-MAVLink bridging exists but only for the legacy generation: RosettaDrone is an open-source Android fram…

- **Confidence:** high · **Vote:** 3-0 (x3 merged claims)
- **Claim:** DJI-to-MAVLink bridging exists but only for the legacy generation: RosettaDrone is an open-source Android framework wrapping DJI's Mobile SDK to expose MAVLink (+ H.264 video) to any MAVLink-speaking GCS (confirmed with QGroundControl, Mission Planner, MAVProxy, MAVSDK — so a custom GCS like GHOST is feasible). It is tested on DJI Mini, Mini SE, Mini 2, Air, Air 2S, Mavic 2, Mavic Pro, Mavic Air series, and Matrice 210 V2 — meaning cheap used consumer DJI drones of that generation CAN be bridged. But it is built against MSDK 4.16.1 (v4, deprecated by DJI); the v4-to-v5 port is an open work-in-progress, so mainline RosettaDrone cannot support MSDK-v5-only drones (Mini 3/Mini 4 class, Mavic 3, Air 3) or SDK-unsupported models (Mini 4K, Neo). The project self-describes as experimental with known gaps (QGC ARM button intentionally disabled, limited waypoint actions via VirtualStick emulation, video fully working mainly on Mavic 2 Pro), and it says nothing about DJI ToS legality.
- **Evidence:** RosettaDrone README verified: 'provides a MAVLink wrapper which allows users to control DJI drones using MAVLink-speaking ground control stations', 'Compatible with... DJI SDK 4.16.1', 'Tested on: DJI Mini, Mini SE, Mini 2, Air, Air 2S, Mavic 2, Mavic Pro, Mavic AIR series, Matrice 210 V2'. Listed on mavlink.io's official implementations page. Maintainer statements confirm v5 porting still in progress (Discussion #157, contributor Sep 2024: 'We're still working on the SDK V4 - V5 porting'); Discussion #205 on Mavic 3 Enterprise/v5 has zero replies. DJI confirms 'MSDK V5 is... not compatible with MSDK V4.' Merged from three unanimously-confirmed claims (all 3-0). 'Tested on' is project-self-reported, not independently benchmarked.
- **Sources:**
  - https://github.com/RosettaDrone/rosettadrone
  - https://mavlink.io
  - https://github.com/m4xw/rosettadrone_mini2
  - https://developer.dji.com

### 6. DJI's official SDK path is narrow and excludes almost all consumer drones: Mobile SDK V5 provides programmatic…

- **Confidence:** high · **Vote:** 3-0 (x3 merged claims)
- **Claim:** DJI's official SDK path is narrow and excludes almost all consumer drones: Mobile SDK V5 provides programmatic APIs 'to control the software and hardware interfaces of an aircraft' — the mechanism by which a self-built telemetry-forwarding bridge app could work — but it is Android-ONLY (no iOS; requirements list Android 5.0 on DJI Smart Controller / Android 10.0 devices, DJI's v5 repo exists only for Android, Dronelink confirms no iOS plans) and supports only an explicitly enumerated aircraft list: Matrice 4D/4TD, 4E/4T, 300 RTK, 350 RTK, M30 series, Mavic 3 Enterprise series, Mavic 3M, Mini 4 Pro, Mini 3, and Mini 3 Pro (GitHub README v5.18.0 also adds Matrice 400 and Mavic 3TA). Consumer Mavic/Air lines, Mini 2, and newer consumer models are NOT MSDK v5-supported. No DJI drone speaks MAVLink natively. Practical upshot: the only current-model DJI + self-built-app path is an Android MSDK v5 app on a Mini 3 / Mini 3 Pro / Mini 4 Pro forwarding telemetry to GHOST's WebSocket bridge — custom development, not off-the-shelf, and its DJI ToS permissibility is unverified.
- **Evidence:** DJI developer portal verified live: exact supported-aircraft enumeration matches the claim; only Android requirements listed, no iOS mention anywhere; verbatim 'a series of APIs to control the software and hardware interfaces of an aircraft.' Cross-checked against the dji-sdk/Mobile-SDK-Android-V5 README (v5.18.0, 2026-05-29) which adds Matrice 400 and Mavic 3TA — both enterprise-class, so the 'most consumer models excluded' conclusion holds. Merged from three unanimously-confirmed claims (all 3-0).
- **Sources:**
  - https://developer.dji.com/mobile-sdk/
  - https://github.com/dji-sdk/Mobile-SDK-Android-V5

### 7. For a turnkey branded MAVLink drone, the ModalAI Starling 2 is the verified option: an NDAA-compliant SLAM dev…

- **Confidence:** high · **Vote:** 3-0 (x2 merged claims)
- **Claim:** For a turnkey branded MAVLink drone, the ModalAI Starling 2 is the verified option: an NDAA-compliant SLAM development drone built on the VOXL 2 companion computer running PX4, therefore natively MAVLink and compatible with MAVLink GCSs (PX4 docs confirm QGroundControl support; ModalAI docs include 'Connect to QGC' guides), and it ships ready-to-fly out-of-the-box (kit includes Commando 8 transmitter and battery; setup is a one-time ELRS bind + WiFi/QGC config). It is a ~$2.5-3.5k development product, not a consumer drone.
- **Evidence:** PX4 official docs verified verbatim: 'Starlings are NDAA-compliant SLAM development drones based on the VOXL 2 and PX4' and 'These development drones are ready-to-fly out-of-the-box.' ModalAI technical docs corroborate the RTF kit contents and QGC connection flow; NDAA '20 Section 848 compliance confirmed via ModalAI press release and Commercial UAV News (April 2024 launch, product current). Merged from two unanimously-confirmed claims (both 3-0). Note: the ~$2.5-3.5k price band is a verifier-supplied contextual figure, not a claim verified against a ModalAI price page — treat as approximate.
- **Sources:**
  - https://docs.px4.io/main/en/complete_vehicles_mc/modalai_starling
  - https://docs.modalai.com

### 8. Simulation removes the hardware dependency entirely, which is the decisive fact for a Kuwait resident: ArduPil…

- **Confidence:** high · **Vote:** 3-0 (x2 merged claims)
- **Claim:** Simulation removes the hardware dependency entirely, which is the decisive fact for a Kuwait resident: ArduPilot SITL is the primary developer simulator, requires no physical flight controller, supports ALL vehicle types (Copter, Rover, Plane, Sub, etc.), and exposes standard MAVLink v2 over TCP 5760 / UDP 14550 — exactly the transports GHOST's Node/TS bridge speaks. For richer physics/visuals, SITL integrates with the latest-generation Gazebo (Garden and Harmonic) as an external simulator for Rover, Copter, and Plane. Both the rover phase and drone phase of GHOST GCS can therefore be developed and exercised end-to-end with zero imports; the residual gaps are hardware-specific edges (real SiK RF behavior, serial transport quirks, sensor failure modes).
- **Evidence:** Official ArduPilot dev docs verified verbatim: 'SITL (Software In The Loop) is the simulator most commonly used by developers... it does not require a flight controller, and all vehicle types are supported' and 'This article explains how to use the latest generation of Gazebo as an external simulator for ArduPilot Rover, Coper [sic] and Plane', with 'We currently support Gazebo Garden and Gazebo Harmonic.' Merged from two unanimously-confirmed claims (both 3-0). Caveats: Gazebo Garden reached upstream EOL Nov 2024 (Harmonic is the LTS); a related claim about specific OS support (Ubuntu 20.04/22.04, macOS 11-13) was REFUTED in verification, so do not rely on that OS matrix — verify current platform support directly. Gazebo is optional; plain SITL suffices for GCS protocol work.
- **Sources:**
  - https://ardupilot.org/dev/docs/simulation-2.html
  - https://ardupilot.org/dev/docs/sitl-with-gazebo.html

### 9. Recommendation matrix synthesized from the verified findings — ROVER PHASE (buy now): a budget ArduPilot-suppo…

- **Confidence:** medium · **Vote:** derived from 3-0 constituents
- **Claim:** Recommendation matrix synthesized from the verified findings — ROVER PHASE (buy now): a budget ArduPilot-supported board (~$30-45, e.g. SpeedyBee F405 Wing) or Pixhawk 6C ($165.99) + chassis/ESC/GPS, chosen from ArduPilot's documented board list; plan the telemetry link around CITRA (the SiK radio is the import-risk item — consider WiFi/UDP telemetry or a locally type-approved link, and verify whether 433MHz or 915MHz is the authorized band before ordering). DRONE PHASE (realistic path): (1) start 100% in SITL/Gazebo now, zero legal exposure; (2) if importing becomes viable, the Holybro X500 V2 Pixhawk 6C 915MHz kit ($533-585, currently sold out) is the DIY reference and Starling 2 the RTF reference; (3) the DJI route is only sensible as either a used legacy Mini/Mavic/Air 2S + RosettaDrone (experimental) or a custom Android MSDK v5 app on Mini 3/4 Pro — neither gives native MAVLink. Flying legally in Kuwait vs. abroad remains the unverified gate on the whole drone phase.
- **Evidence:** Synthesis finding: each component is individually high-confidence (all constituent claims 3-0), but the matrix itself combines them with judgment. Marked medium because the Kuwait flight-authorization side (DGCA rules, hobbyist registration, GCC neighbors' rules for flying abroad) produced NO surviving verified claims — only the import/RF-clearance side is verified — so the 'realistic drone path' ordering rests partly on unverified legal terrain.
- **Sources:**
  - https://ardupilot.org/rover/docs/common-autopilots.html
  - https://www.citra.gov.kw/sites/en/Pages/ServiceDetails.aspx?SrvcID=119
  - https://holybro.com/products/px4-development-kit-x500-v2
  - https://ardupilot.org/dev/docs/simulation-2.html
  - https://github.com/RosettaDrone/rosettadrone

