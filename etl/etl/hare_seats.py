"""Exact Provincia de Buenos Aires allocation under Ley 5109 arts. 109–110."""
from fractions import Fraction


def allocate_seats(votes, seats=9):
    """Allocate list votes only: blank/annulled ballots are never inputs.

    Implemented art. 110 interpretation: repeatedly halve the original quotient
    until a list qualifies, using the reduced quotient BOTH as eligibility
    threshold and divisor. If qualifiers outnumber seats, give one seat to each
    of the most-voted lists. Art. 109(c) completes exhausted residues with the
    candidates of the list with most votes ("hasta completar la representación
    con los candidatos de la lista que obtuvo mayor número de sufragios").
    Equal residue is resolved by votes, never by list id; an equal-vote tie
    affecting who receives a seat raises ValueError("ambiguous_tie").
    """
    if type(seats) is not int or seats <= 0:
        raise ValueError("seats must be a positive integer")
    if not isinstance(votes, dict) or not votes or any(
        not isinstance(k, str) or not k.strip() or type(v) is not int or v < 0
        for k, v in votes.items()
    ) or sum(votes.values()) == 0:
        raise ValueError("list votes must be nonnegative integers with a positive total")
    quotient = Fraction(sum(votes.values()), seats)
    halvings = 0
    eligible = sorted(k for k, v in votes.items() if v >= quotient)
    while not eligible:
        quotient /= 2
        halvings += 1
        eligible = sorted(k for k, v in votes.items() if v >= quotient)
    allocation = dict.fromkeys(votes, 0)
    rules = dict(quotient=False, residue=False, completion=False,
                 art110_halvings=halvings, art110_overflow=len(eligible) > seats)

    def select(ranked, count, priority):
        # Only a tie crossing the award boundary affects representation.
        if 0 < count < len(ranked) and priority(ranked[count - 1]) == priority(ranked[count]):
            raise ValueError("ambiguous_tie")
        return ranked[:count]

    if rules["art110_overflow"]:
        ranked = sorted(eligible, key=lambda k: votes[k], reverse=True)
        for k in select(ranked, seats, lambda k: votes[k]):
            allocation[k] = 1
    else:
        ratios = {k: Fraction(votes[k], 1) / quotient for k in eligible}
        for k, ratio in ratios.items():
            allocation[k] = ratio.numerator // ratio.denominator
        rules["quotient"] = True
        remaining = seats - sum(allocation.values())
        if remaining:
            priority = lambda k: (ratios[k] - allocation[k], votes[k])
            ranked = sorted(eligible, key=priority, reverse=True)
            for k in select(ranked, min(remaining, len(ranked)), priority):
                allocation[k] += 1
                remaining -= 1
            rules["residue"] = True
        if remaining:
            ranked = sorted(eligible, key=lambda k: votes[k], reverse=True)
            winner = select(ranked, 1, lambda k: votes[k])[0]
            allocation[winner] += remaining
            rules["completion"] = True
    return dict(seats=allocation, quotient=str(quotient), quotient_float=float(quotient),
                eligible_list_ids=eligible, rules=rules)
