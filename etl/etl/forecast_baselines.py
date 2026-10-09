"""Frozen baseline definitions (user-decided 2026-10-09).

- Shares are over POSITIVE votes of the JEBA definitive district totals (curated JEBA file, top-level PDF entry per year; 2025 included). Category caveat: JEBA category labels are unauthenticated (pass through `jeba_category_unauthenticated`).
- Mapping from origin year a to destination year b uses ONLY core relations of the correspondence pair (continuation, merge, split); member_overlap is ignored. Merge: destination receives the sum of its origins' shares. Split: an origin's share is divided EQUALLY among its split destinations. An origin may appear in several core relations (e.g. JxC 2023 in merge→LLA 2025 and in split→[LLA 2025, Somos 2025]): define deterministically and document: the origin's share is divided equally across the DISTINCT destination offers it reaches through any core relation (so JxC 2023 → LLA 2025 1/2, Somos 2025 1/2). Exit origins contribute "exit mass".
- B1 persistence: mapped shares kept; exit mass divided equally among ENTRY destination offers (offers with no core predecessor); if there are no entries, renormalize mapped shares to sum 1.
- B2 proportional: exit mass redistributed among destination offers that received mapped share, proportionally to their mapped share; entries get 0. If no destination received mapped share, fall back to equal split over all destination offers and flag it.
- Metrics vs observed JEBA b shares: TV = 1/2 Σ_d |forecast_d − observed_d| over the union of destination offers (exact Fraction + float); seats: allocate 9 seats with hare_seats on forecast votes = forecast share × observed b positive total (exact Fractions OK; hare must accept Fraction votes — if it doesn't, scale shares by a common denominator; document) vs official seats from hare on observed b votes; seat_error = 1/2 Σ_d |seats_forecast_d − seats_observed_d|. If hare raises ambiguous_tie, report it explicitly (never pick).

Hare accepts only integers: multiply forecast votes by their common denominator.
This preserves exact ratios, eligibility, residues and vote tie-breaks. Inputs
use the top-level offers/totals shape verified in the curated 2015–2025 file;
components are never substituted. These numbers are not a model measurement.
"""
from fractions import Fraction
import json
from math import lcm

from etl.hare_seats import allocate_seats


def number(value):
    return dict(exact=f'{value.numerator}/{value.denominator}', float=float(value))


def election_votes(data, year):
    matches = [e for e in data['elections'] if e['year'] == year]
    if len(matches) != 1:
        raise ValueError('unknown or duplicate JEBA year')
    election = matches[0]
    votes = {}
    for offer in election['offers']:
        key, value = offer['list_id'], offer['votes']
        if not isinstance(key, str) or not key.strip() or key in votes:
            raise ValueError('invalid or duplicate list_id')
        if type(value) is not int or value < 0:
            raise ValueError('invalid JEBA votes')
        votes[key] = value
    total = election['totals']['positivos']
    if type(total) is not int or total <= 0 or sum(votes.values()) != total:
        raise ValueError('JEBA offers must sum to positive total')
    return votes, total


def seat_result(votes):
    scale = lcm(*(v.denominator for v in votes.values()))
    try:
        return allocate_seats({k: int(v * scale) for k, v in votes.items()}, 9)
    except ValueError as error:
        if str(error) != 'ambiguous_tie':
            raise
        return dict(error='ambiguous_tie')


def total_variation(forecast_shares, observed_shares):
    """Exact TV over the union of offer ids; absent shares are zero."""
    return sum((abs(forecast_shares.get(k, Fraction(0)) -
                    observed_shares.get(k, Fraction(0)))
                for k in forecast_shares.keys() | observed_shares.keys()), Fraction(0)) / 2


def seat_error(forecast_shares, observed_votes_total, observed_votes):
    """Hare allocations and half-L1 seat error; ambiguous ties remain explicit."""
    allocation = seat_result({k: v * observed_votes_total for k, v in forecast_shares.items()})
    official = seat_result({k: Fraction(v) for k, v in observed_votes.items()})
    error = (None if 'error' in allocation or 'error' in official else
             sum(abs(allocation['seats'].get(k, 0) - official['seats'].get(k, 0))
                 for k in forecast_shares.keys() | observed_votes.keys()) // 2)
    return dict(forecast_seats=allocation, observed_seats=official, seat_error=error)


def core_mapping(correspondence_pair, origin_shares):
    """Map core shares without outcomes; relation destinations define the offer universe.

    Return mapped_shares, exit_mass, entries and destinations, plus origin metadata
    needed by the baseline CLI. Multiple relations reach DISTINCT successors.
    """
    relations = correspondence_pair['relations']
    destinations = sorted({d for relation in relations for d in relation['destinations']})
    reaches = {k: set() for k in origin_shares}
    exits, declared_entries = set(), set()
    for relation in relations:
        kind, left, right = relation['type'], relation['origins'], relation['destinations']
        if not set(left) <= origin_shares.keys():
            raise ValueError('relation references unknown offer')
        if kind in ('continuation', 'merge', 'split'):
            if not left or not right:
                raise ValueError('empty core relation')
            for k in left:
                reaches[k].update(right)
        elif kind == 'exit' and left and not right:
            exits.update(left)
        elif kind == 'entry' and right and not left:
            declared_entries.update(right)
        else:
            raise ValueError('invalid relation type or shape')
    unmapped = {k for k, successors in reaches.items() if not successors}
    mapped = dict.fromkeys(destinations, Fraction(0))
    entries = set(destinations) - set().union(*reaches.values())
    if unmapped != exits or entries != declared_entries:
        raise ValueError('incomplete or conflicting exit/entry coverage')
    mapped_origins = {}
    for k, successors in reaches.items():
        if successors:
            share = origin_shares[k]
            for d in successors:
                mapped[d] += share / len(successors)
            mapped_origins[k] = dict(destinations=sorted(successors), share=number(share))
    exit_mass = sum((origin_shares[k] for k in exits), Fraction(0))
    return dict(mapped_shares=mapped, exit_mass=exit_mass, entries=sorted(entries),
                destinations=destinations, mapped_origins=mapped_origins, exit_origins=sorted(exits))


def baselines(args):
    from etl.dine_municipal_panel import strict_object
    def load(path):
        return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=strict_object)
    data, correspondence = load(args.jeba), load(args.correspondence)
    a, b = args.pair
    pairs = correspondence['pairs']
    years = sorted({p[k] for p in pairs for k in ('origin_year', 'destination_year')})
    matches = [p for p in pairs if (p['origin_year'], p['destination_year']) == (a, b)]
    if len(matches) != 1 or (a, b) not in list(zip(years, years[1:])):
        raise ValueError('invalid pair: must be consecutive in correspondence')
    origin, origin_total = election_votes(data, a)
    observed, total = election_votes(data, b)
    if any(not set(r['destinations']) <= observed.keys() for r in matches[0]['relations']):
        raise ValueError('relation references unknown offer')
    mapping = core_mapping(matches[0], {k: Fraction(v, origin_total) for k, v in origin.items()})
    if set(mapping['destinations']) != observed.keys():
        raise ValueError('incomplete or conflicting exit/entry coverage')
    mapped = {k: mapping['mapped_shares'][k] for k in observed}
    entries, exits = mapping['entries'], mapping['exit_origins']
    mapped_origins, exit_mass = mapping['mapped_origins'], mapping['exit_mass']
    mass = sum(mapped.values())
    persistence = ({k: v + (exit_mass / len(entries) if k in entries else 0)
                    for k, v in mapped.items()} if entries else
                   {k: v / mass for k, v in mapped.items()})
    proportional = ({k: v / mass for k, v in mapped.items()} if mass else
                    dict.fromkeys(observed, Fraction(1, len(observed))))
    result = dict(origin_year=a, destination_year=b, jeba_category_unauthenticated=True,
                  exit_mass=number(exit_mass), exit_origins=sorted(exits), entries=sorted(entries),
                  mapped_origins=mapped_origins,
                  ignored_by_reason={'member_overlap': len(matches[0].get('member_overlap', []))})
    tvs = {}
    for name, forecast in (('B1', persistence), ('B2', proportional)):
        tv = total_variation(forecast, {k: Fraction(v, total) for k, v in observed.items()})
        metrics = seat_error(forecast, total, observed)
        allocation, error = metrics['forecast_seats'], metrics['seat_error']
        result['observed_seats'] = metrics['observed_seats']
        result[name] = dict(shares={k: number(v) for k, v in forecast.items()}, TV=number(tv),
                            forecast_seats=allocation, seat_error=error,
                            fallback_equal_split=name == 'B2' and not mass)
        tvs[name] = tv
    result['best_baseline'] = 'tie' if tvs['B1'] == tvs['B2'] else min(tvs, key=tvs.get)
    return result
