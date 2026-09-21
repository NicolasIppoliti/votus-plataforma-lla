"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ALLOCATION_LEVEL } from "@/domain/seat-allocation/types";
import { GRANULARITY } from "@/lib/results/types";
import { projectionGranularitySchema } from "./projection-input";
import {
  createSimulationScenario,
  SimulationFormError,
  type SimulationFormListValues,
  type SimulationFormValues,
} from "./simulation-form-adapter";
import { SIMULATION_COUNCIL } from "./simulation-configuration";

const INITIAL_VALUES: SimulationFormValues = {
  level: ALLOCATION_LEVEL.PBA_MUNICIPAL,
  granularity: GRANULARITY.SECCION,
  seatsToFill: "",
  totalVotes: "",
  blankVotes: "0",
  annulledVotes: "0",
  padron: "",
  thresholdPercent: "3",
  lists: [{ id: "list-1", name: "", votes: "" }],
};

const LIST_FIELD = {
  NAME: "name",
  VOTES: "votes",
} as const;

type ListField = (typeof LIST_FIELD)[keyof typeof LIST_FIELD];

const GRANULARITY_LABELS = {
  [GRANULARITY.MESA]: "Mesa",
  [GRANULARITY.ESTABLECIMIENTO]: "Establecimiento",
  [GRANULARITY.CIRCUITO]: "Circuito",
  [GRANULARITY.SECCION]: "Sección",
  [GRANULARITY.DISTRITO]: "Distrito",
} as const;

interface NumberFieldProps {
  describedBy: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}

function NumberField({
  describedBy,
  id,
  label,
  onChange,
  value,
}: NumberFieldProps) {
  return (
    <div className="field">
      <Label htmlFor={id}>{label}</Label>
      <Input
        aria-describedby={describedBy}
        id={id}
        inputMode="numeric"
        min="0"
        onChange={(event) => onChange(event.target.value)}
        required
        step="1"
        type="number"
        value={value}
      />
    </div>
  );
}

export function SimulationForm() {
  const [values, setValues] = useState<SimulationFormValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<readonly string[]>([]);
  const nextListId = useRef(2);
  const listNameInputRefs = useRef(new Map<string, HTMLInputElement>());
  const pendingListNameFocusId = useRef<string | null>(null);

  useEffect(() => {
    const focusId = pendingListNameFocusId.current;
    if (focusId === null) return;

    pendingListNameFocusId.current = null;
    const input = listNameInputRefs.current.get(focusId);
    if (input?.isConnected && !input.disabled) input.focus();
  }, [values.lists]);

  function handleLevelChange(event: ChangeEvent<HTMLSelectElement>) {
    const level = event.target.value;
    if (
      level === ALLOCATION_LEVEL.PBA_MUNICIPAL ||
      level === ALLOCATION_LEVEL.PBA_PROVINCIAL ||
      level === ALLOCATION_LEVEL.NATIONAL
    ) {
      setValues((current) => ({ ...current, level }));
      setErrors([]);
    }
  }

  function handleGranularityChange(event: ChangeEvent<HTMLSelectElement>) {
    const granularity = projectionGranularitySchema.safeParse(event.target.value);
    if (granularity.success) {
      setValues((current) => ({ ...current, granularity: granularity.data }));
      setErrors([]);
    }
  }

  function updateList(id: string, field: ListField, value: string) {
    setValues((current) => ({
      ...current,
      lists: current.lists.map((list) =>
        list.id === id ? { ...list, [field]: value } : list,
      ),
    }));
  }

  function addList() {
    const list: SimulationFormListValues = {
      id: `list-${nextListId.current}`,
      name: "",
      votes: "",
    };
    nextListId.current += 1;
    pendingListNameFocusId.current = list.id;
    setValues((current) => ({
      ...current,
      lists: [...current.lists, list],
    }));
  }

  function removeList(id: string) {
    if (values.lists.length === 1) return;

    const removedIndex = values.lists.findIndex((list) => list.id === id);
    if (removedIndex === -1) return;

    const remainingLists = values.lists.filter((list) => list.id !== id);
    const nextFocusIndex = Math.min(removedIndex, remainingLists.length - 1);
    pendingListNameFocusId.current = remainingLists[nextFocusIndex]?.id ?? null;
    setValues((current) => ({
      ...current,
      lists: current.lists.filter((list) => list.id !== id),
    }));
  }

  function submitSimulation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const scenario = createSimulationScenario(values);
      const query = new URLSearchParams();
      query.set("input", JSON.stringify(scenario.input));
      if (scenario.council) query.set("council", scenario.council);
      window.location.assign(`/simulate?${query.toString()}`);
    } catch (error) {
      setErrors(
        error instanceof SimulationFormError
          ? error.messages
          : ["No se pudo preparar la simulación. Revise los datos ingresados."],
      );
    }
  }

  const isNational = values.level === ALLOCATION_LEVEL.NATIONAL;
  const isMunicipal = values.level === ALLOCATION_LEVEL.PBA_MUNICIPAL;
  const totalsHelpId = isNational ? "national-totals-help" : "pba-totals-help";

  return (
    <section
      aria-labelledby="simulation-form-heading"
      className="simulation-builder"
    >
      <h2 id="simulation-form-heading">Crear un escenario</h2>
      <p className="simulation-builder__help" id="simulation-form-help">
        Ingrese los datos del escenario. La simulación no guarda información ni
        representa un resultado histórico oficial.
      </p>
      <form
        aria-label="Formulario de simulación de bancas"
        className="simulation-form"
        noValidate
        onSubmit={submitSimulation}
      >
        <div
          aria-atomic="true"
          aria-live="polite"
          className="simulation-form__feedback"
          id="simulation-form-errors"
        >
          {errors.length > 0 ? (
            <div role="alert">
              <p>Revise los siguientes datos:</p>
              <ul>
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <fieldset className="simulation-form__section panel form-grid">
          <legend className="simulation-form__legend">Elección y alcance</legend>
          <div className="field">
            <Label htmlFor="simulation-level">Tipo de elección</Label>
            <select
              aria-describedby="simulation-form-help simulation-form-errors"
              id="simulation-level"
              onChange={handleLevelChange}
              value={values.level}
            >
              <option value={ALLOCATION_LEVEL.PBA_MUNICIPAL}>
                Concejo deliberante municipal (PBA)
              </option>
              <option value={ALLOCATION_LEVEL.PBA_PROVINCIAL}>
                Legislatura provincial (PBA)
              </option>
              <option value={ALLOCATION_LEVEL.NATIONAL}>Elección nacional</option>
            </select>
          </div>
          <div className="field">
            <Label htmlFor="simulation-granularity">Granularidad</Label>
            <select
              aria-describedby="granularity-help simulation-form-errors"
              id="simulation-granularity"
              onChange={handleGranularityChange}
              value={values.granularity}
            >
              {Object.entries(GRANULARITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <p id="granularity-help">
              Seleccione el alcance al que corresponden los votos ingresados.
            </p>
          </div>
        </fieldset>

        {isMunicipal ? (
          <section
            aria-labelledby="municipal-configuration-heading"
            className="simulation-form__section simulation-form__section--context panel panel--quiet"
          >
            <h3 id="municipal-configuration-heading">Concejo configurado</h3>
            <dl className="simulation-form__context">
              <dt>Municipio admitido</dt>
              <dd>{SIMULATION_COUNCIL.JURISDICTION}</dd>
              <dt>Composición total</dt>
              <dd>{SIMULATION_COUNCIL.TOTAL_SEATS} bancas</dd>
              <dt>Bancas renovadas por elección</dt>
              <dd>{SIMULATION_COUNCIL.SEATS_PER_ELECTION} bancas</dd>
            </dl>
            <p role="note">
              Estas cantidades son fijas para este municipio y no se pueden
              modificar desde el formulario.
            </p>
          </section>
        ) : null}

        <fieldset className="simulation-form__section panel form-grid">
          <legend className="simulation-form__legend">Totales del escenario</legend>
          <p id={totalsHelpId}>
            {isNational
              ? "El total de votos no puede superar el padrón."
              : "Informe el total de votos y, por separado, los votos en blanco y anulados."}
          </p>
          {isNational ? (
            <NumberField
              describedBy={`${totalsHelpId} simulation-form-errors`}
              id="simulation-padron"
              label="Padrón"
              onChange={(padron) =>
                setValues((current) => ({ ...current, padron }))
              }
              value={values.padron}
            />
          ) : null}
          <NumberField
            describedBy={`${totalsHelpId} simulation-form-errors`}
            id="simulation-total-votes"
            label="Total de votos"
            onChange={(totalVotes) =>
              setValues((current) => ({ ...current, totalVotes }))
            }
            value={values.totalVotes}
          />
          {!isNational ? (
            <>
              <NumberField
                describedBy={`${totalsHelpId} simulation-form-errors`}
                id="simulation-blank-votes"
                label="Votos en blanco"
                onChange={(blankVotes) =>
                  setValues((current) => ({ ...current, blankVotes }))
                }
                value={values.blankVotes}
              />
              <NumberField
                describedBy={`${totalsHelpId} simulation-form-errors`}
                id="simulation-annulled-votes"
                label="Votos anulados"
                onChange={(annulledVotes) =>
                  setValues((current) => ({ ...current, annulledVotes }))
                }
                value={values.annulledVotes}
              />
            </>
          ) : null}
          {!isMunicipal ? (
            <NumberField
              describedBy={`${totalsHelpId} simulation-form-errors`}
              id="simulation-seats"
              label="Bancas a asignar"
              onChange={(seatsToFill) =>
                setValues((current) => ({ ...current, seatsToFill }))
              }
              value={values.seatsToFill}
            />
          ) : null}
          {isNational ? (
            <div className="field">
              <Label htmlFor="simulation-threshold">Porcentaje de umbral</Label>
              <Input
                aria-describedby="threshold-help simulation-form-errors"
                id="simulation-threshold"
                inputMode="decimal"
                min="0"
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    thresholdPercent: event.target.value,
                  }))
                }
                required
                step="0.01"
                type="number"
                value={values.thresholdPercent}
              />
              <p id="threshold-help">
                El porcentaje se calcula sobre el padrón ingresado.
              </p>
            </div>
          ) : null}
        </fieldset>

        <fieldset className="simulation-form__section panel form-grid">
          <legend className="simulation-form__legend">Listas y votos</legend>
          <p id="simulation-lists-help">
            Agregue al menos una lista. Cada lista conserva un identificador
            interno único durante la edición.
          </p>
          {values.lists.map((list, index) => {
            const listNameId = `simulation-list-name-${list.id}`;
            const listVotesId = `simulation-list-votes-${list.id}`;
            return (
              <div
                className="simulation-form__list panel panel--quiet"
                key={list.id}
              >
                <h3>Lista {index + 1}</h3>
                <div className="simulation-form__list-fields form-grid">
                  <div className="field">
                    <Label htmlFor={listNameId}>Nombre de la lista</Label>
                    <Input
                      aria-describedby="simulation-lists-help simulation-form-errors"
                      id={listNameId}
                      onChange={(event) =>
                        updateList(list.id, LIST_FIELD.NAME, event.target.value)
                      }
                      ref={(input) => {
                        if (input === null) {
                          listNameInputRefs.current.delete(list.id);
                        } else {
                          listNameInputRefs.current.set(list.id, input);
                        }
                      }}
                      required
                      type="text"
                      value={list.name}
                    />
                  </div>
                  <NumberField
                    describedBy="simulation-lists-help simulation-form-errors"
                    id={listVotesId}
                    label="Votos de la lista"
                    onChange={(votes) =>
                      updateList(list.id, LIST_FIELD.VOTES, votes)
                    }
                    value={list.votes}
                  />
                </div>
                <Button
                  aria-label={`Quitar ${list.name.trim() || `lista ${index + 1}`}`}
                  className="justify-self-start"
                  variant="outline"
                  disabled={values.lists.length === 1}
                  onClick={() => removeList(list.id)}
                  type="button"
                >
                  Quitar lista
                </Button>
              </div>
            );
          })}
          <div className="form-actions">
            <Button
              variant="outline"
              onClick={addList}
              type="button"
            >
              Agregar lista
            </Button>
          </div>
        </fieldset>

        <div className="form-actions">
          <Button variant="solid" type="submit">
            Simular bancas
          </Button>
        </div>
      </form>
    </section>
  );
}
