# 0001 — Browser history for territorial exploration

Status: Accepted

Decision owner: Product owner (goal-owner decision for issue #488).

## Decision

Deliberate territorial traversal pushes a browser-history entry: opening a child
unit through the territorial navigator, choosing an ancestor in its trail, or
using its internal parent button. Frequent selector/filter edits replace the
current entry instead.

Browser Back and Forward therefore revisit territorial waypoints, not every
intermediate filter edit. They must restore the exact URL selection and show
only evidence served for that selection; while a different selection is being
requested, stale results remain hidden by the existing selection boundary.

Internal parent navigation remains available. Canonical, exact shareable URLs
and their full territorial lineage remain unchanged. This decision does not
change the municipal page or its readability without JavaScript.

## Rationale and tradeoff

Territorial descent is an intentional exploration journey worth retracing.
Replacing frequent filter changes avoids filling history with incidental edits.
The tradeoff is that Back does not undo each filter edit: replacing an entry
updates that waypoint, including when a filter is edited after traversal.
Choosing an ancestor deliberately also adds a waypoint rather than simulating
Browser Back, so it works even when a user arrived through a shared deep link.

This is a product-owner policy decision, **not observed analyst research** or a
claim about measured user behavior. Future research may inform a new decision.

## Verification

Component tests invoke the real form/navigator handlers for child, ancestor,
parent-button and selector actions. The provenance browser journey traverses
section → circuit → establishment → mesa, then checks exact URLs, restored
selection and served evidence through Back and Forward. The browser journey is
run by CI, not locally for this change.
