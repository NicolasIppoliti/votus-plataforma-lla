"""Printed council evidence from the verified 2025 Junta HTML layout.

Only data-table and detail-group elements are captured. This does not accept
a historical council series, derive missing counts or choose a source version.
"""

import re
from collections import Counter
from html.parser import HTMLParser

from .numeric import parse_source_int

FIELD_LABELS = {
    "VOTOS POSITIVOS": "positive_votes",
    "VOTO EN BLANCO": "blank_votes",
    "VOTOS EN BLANCO": "blank_votes",
    "VOTOS NULOS": "null_votes",
    "TOTAL DE VOTOS": "total_votes",
    "ELECTORES HABILITADOS": "total_electors",
    "TOTAL DE MESAS": "total_mesas",
    "MESAS ESCRUTADAS": "counted_mesas",
}
FIELDS = tuple(dict.fromkeys(FIELD_LABELS.values()))
VOID_TAGS = frozenset({"area", "base", "br", "col", "embed", "hr", "img", "input",
                       "link", "meta", "param", "source", "track", "wbr"})


class _Node:
    def __init__(self, tag, attrs):
        self.tag = tag
        self.attrs = dict(attrs)
        self.classes = set((self.attrs.get("class") or "").split())
        self.parts = []
        self.closed = tag in VOID_TAGS


class _BoundedHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.roots = []
        self.stack = []

    def handle_starttag(self, tag, attrs):
        node = _Node(tag, attrs)
        capture = (tag == "table" and "data-table" in node.classes or
                   tag == "div" and bool(node.classes & {
                       "detail-group", "detail-group-big", "detail-group-small"}))
        if not self.stack and not capture:
            return
        if self.stack:
            self.stack[-1].parts.append(node)
        else:
            self.roots.append(node)
        if tag not in VOID_TAGS:
            self.stack.append(node)

    def handle_endtag(self, tag):
        if self.stack and self.stack[-1].tag == tag:
            self.stack[-1].closed = True
            self.stack.pop()

    def handle_data(self, data):
        if self.stack:
            self.stack[-1].parts.append(data)


def _nodes(node, tag=None):
    if tag is None or node.tag == tag:
        yield node
    for part in node.parts:
        if isinstance(part, _Node):
            yield from _nodes(part, tag)


def _text(node):
    return " ".join("".join(_text(part) if isinstance(part, _Node) else part
                            for part in node.parts).split())


def _cells(row, tag):
    nodes = [node for node in row.parts if isinstance(node, _Node)]
    malformed = any(
        node.tag != tag or not node.closed
        or any(node.attrs.get(attr) not in {None, "1"} for attr in ("colspan", "rowspan"))
        or any(child.tag in {"table", "tr", "td", "th"}
               for child in _nodes(node) if child is not node)
        for node in nodes
    )
    return None if malformed else nodes


def _integer(raw):
    if not re.fullmatch(r"(?:[0-9]{1,3}(?:\.[0-9]{3})+|[0-9]+)", raw):
        return None
    return parse_source_int(raw.replace(".", ""))


def _percent(raw):
    match = re.fullmatch(r"([0-9]+(?:[.,][0-9]+)?)\s*%?", raw)
    if not match:
        return None
    return match[1].replace(",", ".")


def extract(data: bytes) -> tuple[dict, list[str]]:
    parser = _BoundedHTML()
    parser.feed(data.decode("utf-8-sig", errors="strict"))
    parser.close()
    rows, evidence, uncertainty = [], [], []
    observations = {field: [] for field in FIELDS}
    exclusions = Counter()
    ambiguous_fields = set()
    category = None

    def observe(field, label, raw, location, percent=None, denominator=None):
        parsed = _integer(raw)
        observations[field].append(parsed)
        item = {"field": field, "label": label,
                "printed_value": raw if parsed is not None else None, "location": location}
        if percent is not None:
            item.update(printed_percent=_percent(percent), percent_denominator=denominator)
        evidence.append(item)

    groups = [node for node in parser.roots if node.tag == "div"]
    for index, group in enumerate(groups, 1):
        labels = [node for node in _nodes(group) if "detail-label" in node.classes]
        values = [node for node in _nodes(group) if "detail-value" in node.classes]
        recognized = [_text(node) for node in labels if _text(node).upper() in FIELD_LABELS]
        valid = (group.closed and len(labels) == 1 and
                 all(node.closed and node in group.parts for node in labels + values))
        for label in recognized:
            field = FIELD_LABELS.get(label.upper())
            if field not in {"total_electors", "total_mesas", "counted_mesas"}:
                continue
            location = f"detail-group[{index}]"
            if valid:
                for value_index, value in enumerate(values or [None], 1):
                    raw = _text(value) if value is not None else ""
                    observe(field, label, raw, f"{location}/value[{value_index}]")
            else:
                ambiguous_fields.add(field)
                observations[field].append(None)
                evidence.append({"field": field, "label": label, "printed_value": None,
                                 "location": location, "binding": "ambiguous",
                                 "printed_labels": recognized,
                                 "printed_values": [_text(value) for value in values
                                                    if _integer(_text(value)) is not None],
                                 "label_count": len(labels), "value_count": len(values)})

    tables = [node for node in parser.roots if node.tag == "table"]
    if len(tables) != 1:
        uncertainty.append("html_table_missing" if not tables else "html_table_repeated")
    elif not tables[0].closed:
        uncertainty.append("html_structure_malformed")
    else:
        table_rows = list(_nodes(tables[0], "tr"))
        headers = [row for row in table_rows if any(node.tag == "th" for node in _nodes(row))]
        if len(headers) != 1:
            uncertainty.append("html_header_row_missing" if not headers else
                               "html_header_row_repeated")
        else:
            header_cells = _cells(headers[0], "th")
            header = [_text(node) for node in header_cells] if header_cells is not None else []
            if header_cells is None:
                uncertainty.append("html_header_row_malformed")
            elif (len(header) < 2 or header[0].upper() != "LISTA"
                  or header[1].upper() not in {"PARTIDOS POLÍTICOS", "PARTIDOS POLITICOS"}):
                uncertainty.append("html_identity_header_unsupported")
                header = []
            indices = [i for i, label in enumerate(header)
                       if label.upper() in {"CONCEJALES", "CONCEJALES TITULARES"}]
            if len(indices) != 1:
                uncertainty.append("html_category_header_missing" if not indices else
                                   "html_category_header_repeated")
            elif indices[0] + 1 >= len(header) or header[indices[0] + 1].upper() != "PORCENTAJE":
                uncertainty.append("html_category_percent_header_missing")
            else:
                category = "CONCEJALES"
                column = indices[0]
                for index, row in enumerate(table_rows, 1):
                    if row is headers[0]:
                        continue
                    cell_nodes = _cells(row, "td")
                    if cell_nodes is None:
                        exclusions["html_row_structure_malformed"] += 1
                        continue
                    cells = [_text(node) for node in cell_nodes]
                    if len(cells) != len(header):
                        exclusions["table_row_width_mismatch"] += 1
                        continue
                    raw, percent = cells[column:column + 2]
                    location = f"data-table[1]/row[{index}]/cell[{column + 1}]"
                    field = FIELD_LABELS.get(cells[1].upper())
                    if not cells[0] and field in {"positive_votes", "blank_votes", "null_votes",
                                                 "total_votes"}:
                        denominator = "total_electors" if field == "total_votes" else "total_votes"
                        observe(field, cells[1], raw, location, percent, denominator)
                        continue
                    if raw == percent == "-":
                        exclusions["category_not_contested"] += 1
                        continue
                    votes, printed_percent = _integer(raw), _percent(percent)
                    if not re.fullmatch(r"[0-9]+", cells[0]) or not cells[1]:
                        exclusions["list_identity_malformed"] += 1
                    elif votes is None:
                        exclusions["list_vote_malformed"] += 1
                    elif printed_percent is None:
                        exclusions["list_percent_malformed"] += 1
                    else:
                        rows.append({"location": location, "list_id": cells[0],
                                     "group_name": cells[1], "printed_votes": votes,
                                     "printed_percent": printed_percent,
                                     "printed_percent_denominator": "positive_votes"})

    fields = dict.fromkeys(FIELDS)
    for field, values in observations.items():
        if field in ambiguous_fields:
            uncertainty.append(f"printed_field_ambiguous:{field}")
            continue
        if len(values) == 1 and values[0] is not None:
            fields[field] = values[0]
            continue
        reason = ("missing" if not values else "malformed" if len(values) == 1 else
                  "conflicting" if len(set(values)) > 1 else "repeated")
        uncertainty.append(f"printed_field_{reason}:{field}")
    if len({row["list_id"] for row in rows}) != len(rows):
        uncertainty.append("list_id_repeated")
    unparsed = sum(count for reason, count in exclusions.items()
                   if reason != "category_not_contested")
    if unparsed:
        uncertainty.append("table_rows_unparsed")
    if not rows:
        uncertainty.append("list_table_empty")
    return {"fields": fields, "field_evidence": evidence, "list_rows": rows,
            "category": category, "exclusions_by_reason": dict(sorted(exclusions.items())),
            "unparsed_table_rows": unparsed}, uncertainty
