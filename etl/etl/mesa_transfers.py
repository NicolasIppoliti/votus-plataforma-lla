"""Deterministic ecological point estimates, not individual voter transitions."""
from fractions import Fraction
import math

NON_POSITIVE = '__non_positive__'
CATEGORY_RULE = ('Each agrupacion_id is its own category; never pool unknown offers. '
                 'Add __non_positive__ = electores - positivo; exclude negative residual mesas.')


def validate_recipe(recipe):
    fixed = dict(schema_version=1, weighting='origin_electores', init='destination_share_rows',
                 categories=CATEGORY_RULE, declared_on='2026-10-09', lipschitz='power_iteration',
                 note='declared before any backtest measurement')
    if not isinstance(recipe, dict) or set(recipe) != set(fixed) | {'tol', 'max_iter', 'power_iterations', 'safety_factor', 'accelerator'}:
        raise ValueError('unexpected or missing recipe fields')
    if type(recipe['schema_version']) is not int or any(recipe[k] != v for k, v in fixed.items()):
        raise ValueError('unsupported recipe declaration')
    if recipe['accelerator'] not in ('none', 'fista_with_monotone_restart'):
        raise ValueError('unsupported accelerator')
    try:
        tolerance = Fraction(recipe['tol']) if isinstance(recipe['tol'], str) else 0
    except (ValueError, ZeroDivisionError):
        raise ValueError('tol must be a positive finite rational string') from None
    if not 0 < tolerance < 1 or not math.isfinite(float(tolerance)):
        raise ValueError('tol must be in (0,1)')
    if type(recipe['max_iter']) is not int or recipe['max_iter'] <= 0:
        raise ValueError('max_iter must be a positive integer')
    if type(recipe['power_iterations']) is not int or recipe['power_iterations'] <= 0:
        raise ValueError('power_iterations must be a positive integer')
    try:
        safety = Fraction(recipe['safety_factor']) if isinstance(recipe['safety_factor'], str) else 0
        valid = safety > 1 and math.isfinite(float(safety))
    except (ValueError, ZeroDivisionError, OverflowError):
        valid = False
    if not valid:
        raise ValueError('safety_factor must be a finite rational string greater than 1')


def power_lipschitz(gram, iterations, safety_factor):
    """All-ones power iteration for a nonnegative Gram matrix.

    The final max (Gv)_r/v_r is a Collatz upper bound, not an unguarded
    Rayleigh underestimate. Zero components arise only in zero Gram rows
    (or underflow); retaining a tiny positive floor keeps the bound valid.
    """
    vector = [1.0] * len(gram)
    for _ in range(iterations):
        product = [sum(value * v for value, v in zip(row, vector)) for row in gram]
        scale = max(product)
        if scale <= 0:
            raise ValueError('zero Gram matrix')
        vector = [max(value / scale, 1e-300) for value in product]
    product = [sum(value * v for value, v in zip(row, vector)) for row in gram]
    return max(value / v for value, v in zip(product, vector)) * float(Fraction(safety_factor))


def project_simplex(values):
    """Sort-based Euclidean projection onto the simplex (Duchi et al.)."""
    ordered = sorted(values, reverse=True)
    cumulative = 0.0
    theta = 0.0
    for index, value in enumerate(ordered, 1):
        cumulative += value
        candidate = (cumulative - 1.0) / index
        if value > candidate:
            theta = candidate
    return [max(value - theta, 0.0) for value in values]


def solve(x_exact, y_exact, weights, destination_weights, recipe):
    """FISTA (Beck & Teboulle 2009) or PGD; report full weighted SSE.

    L is a safety-scaled power-iteration upper estimate for lambda_max(X^T W X).
    Sufficient statistics avoid a mesa loop on every iteration.
    """
    x = [[float(v) for v in row] for row in x_exact]
    y = [[float(v) for v in row] for row in y_exact]
    rows, columns = len(x[0]), len(y[0])
    gram = [[sum(w * xi[r] * xi[s] for xi, w in zip(x, weights))
             for s in range(rows)] for r in range(rows)]
    cross = [[sum(w * xi[r] * yi[c] for xi, yi, w in zip(x, y, weights))
              for c in range(columns)] for r in range(rows)]
    bound = power_lipschitz(gram, recipe['power_iterations'], recipe['safety_factor'])
    overall = [float(sum((yi[c] * w for yi, w in zip(y_exact, destination_weights)), Fraction())
                     / sum(destination_weights)) for c in range(columns)]
    matrix = [overall[:] for _ in range(rows)]
    def step(point):
        return [project_simplex([point[r][c] -
            (sum(gram[r][s] * point[s][c] for s in range(rows)) - cross[r][c]) / bound
            for c in range(columns)]) for r in range(rows)]

    momentum, extrapolated = 1.0, matrix
    accelerated = recipe['accelerator'] != 'none'
    converged = False
    for iteration in range(1, recipe['max_iter'] + 1):
        updated = step(extrapolated)
        # Exact quadratic difference avoids subtracting two large SSE values.
        increase = sum((updated[r][c] - matrix[r][c]) *
            (sum(gram[r][s] * (updated[s][c] + matrix[s][c]) for s in range(rows))
             - 2 * cross[r][c]) for r in range(rows) for c in range(columns))
        if accelerated and increase > 0:
            momentum, extrapolated = 1.0, matrix
            updated = step(extrapolated)
        delta = max(abs(updated[r][c] - matrix[r][c]) for r in range(rows) for c in range(columns))
        next_momentum = (1 + math.sqrt(1 + 4 * momentum ** 2)) / 2 if accelerated else 1.0
        beta = (momentum - 1) / next_momentum
        extrapolated = [[updated[r][c] + beta * (updated[r][c] - matrix[r][c])
                         for c in range(columns)] for r in range(rows)]
        momentum, matrix = next_momentum, updated
        if delta < float(Fraction(recipe['tol'])):
            converged = True
            break
    fitted = [[sum(xi[r] * matrix[r][c] for r in range(rows)) for c in range(columns)] for xi in x]
    objective = sum(w * sum((pred[c] - yi[c]) ** 2 for c in range(columns))
                    for pred, yi, w in zip(fitted, y, weights))
    return matrix, fitted, iteration, converged, objective, bound


def estimate_transfers(pair, recipe):
    validate_recipe(recipe)
    excluded = dict(not_aligned=len(pair['unaligned']), negative_non_positive=0)
    usable = []
    for entry in pair['aligned']:
        if any(entry[side]['electores'] - entry[side]['votes']['positivo'] < 0
               for side in ('origin', 'destination')):
            excluded['negative_non_positive'] += 1
        else:
            usable.append(entry)
    if not usable:
        raise ValueError('no usable aligned mesas')
    categories, labels = {}, {}
    for side in ('origin', 'destination'):
        offers = {}
        # Offers absent from usable mesas remain explicit, unidentifiable categories.
        for record in pair['category_records'][side]:
            for offer, value in record['positive'].items():
                if offer == NON_POSITIVE:
                    raise ValueError('offer id collides with non-positive category')
                if offer in offers and offers[offer] != value['name']:
                    raise ValueError('conflicting offer labels')
                offers[offer] = value['name']
        categories[side] = sorted(offers) + [NON_POSITIVE]
        labels[side] = dict(offers, **{NON_POSITIVE: 'Non-positive (electores - positivo)'})
    shares = {}
    for side in ('origin', 'destination'):
        shares[side] = []
        for entry in usable:
            record = entry[side]
            positive = record['positive']
            if (any(type(v['votes']) is not int or v['votes'] < 0 for v in positive.values())
                    or sum(v['votes'] for v in positive.values()) != record['votes']['positivo']):
                raise ValueError('invalid positive counts or positivo mismatch')
            counts = [positive.get(k, {'votes': 0})['votes'] for k in categories[side][:-1]]
            counts.append(record['electores'] - record['votes']['positivo'])
            shares[side].append([Fraction(v, record['electores']) for v in counts])
    weights = [entry['origin']['electores'] for entry in usable]
    destination_weights = [entry['destination']['electores'] for entry in usable]
    matrix, fitted, iterations, converged, objective, bound = solve(
        shares['origin'], shares['destination'], weights, destination_weights, recipe)
    totals = {category: dict(
        implied=sum(pred[c] * w for pred, w in zip(fitted, destination_weights)),
        observed=int(sum((yi[c] * w for yi, w in zip(shares['destination'], destination_weights)), Fraction())))
        for c, category in enumerate(categories['destination'])}
    return dict(schema_version=1, origin_year=pair['origin_year'], destination_year=pair['destination_year'],
        matrix={origin: {dest: round(matrix[r][c], 9) for c, dest in enumerate(categories['destination'])}
                for r, origin in enumerate(categories['origin'])}, labels=labels,
        destination_totals=totals, mesas_used=len(usable), mesas_excluded_by_reason=excluded,
        alignment_excluded_by_reason=pair['counts'], iterations=iterations, converged=converged,
        objective=objective, weighting=recipe['weighting'], init=recipe['init'],
        step_size=1 / bound, lipschitz_bound=bound,
        step_rule='1 / safety-scaled power Collatz bound; gradient of half weighted SSE', recipe=recipe)
