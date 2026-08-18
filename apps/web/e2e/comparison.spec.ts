import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { assertE2eEnvironment } from "./gate-contract";
import { withResultFixture } from "./result-fixture";
import { resultScenarioIdentity, scenarioBaseUrl } from "./scenario-ownership";

/**
 * provenance-display spec: "Mixed-granularity comparison is flagged in the
 * display, not just the API" — the `/compare` page must visibly show the
 * D6 refusal, not merely encode it in a `status` field the UI ignores.
 *
 * Simplification, disclosed: real ingestion never produces two elections'
 * rows sharing one `jurisdiction_id` at different `granularity` values. This
 * fixture seeds that table shape specifically to prove the reachable page
 * displays the refusal.
 */

const environment = assertE2eEnvironment(process.env);
const SPEC = "e2e/comparison.spec.ts";
const identity = resultScenarioIdentity(SPEC);
const party = identity.comparisonParty;
if (!party) throw new Error("comparison party identity is missing");
const baseURL = scenarioBaseUrl(SPEC, environment);
const admin = createClient(
  environment.NEXT_PUBLIC_SUPABASE_URL,
  environment.SUPABASE_SERVICE_ROLE_KEY,
);

interface SupabaseOperation {
  error: { message: string } | null;
}

function assertOperation(operation: SupabaseOperation, label: string): void {
  if (operation.error) throw new Error(`${label}: ${operation.error.message}`);
}

test.describe("mixed-granularity comparison is flagged in the display", () => {
  test.beforeAll(async () => {
    assertOperation(
      await admin.from("party_canonical").insert({
        id: party.canonicalPartyId,
        display_name: party.displayName,
      }),
      "failed to seed canonical party",
    );
    try {
      assertOperation(
        await admin.from("party_mapping").insert(
          identity.electionYears.map((year, index) => ({
            id: party.mappingIds[index]!,
            year,
            jurisdiction: party.jurisdiction,
            category: identity.categoryName,
            list_id: party.listIds[index]!,
            canonical_party_id: party.canonicalPartyId,
            verified: true,
            source: SPEC,
          })),
        ),
        "failed to seed party mappings",
      );
    } catch (error) {
      await admin
        .from("party_canonical")
        .delete()
        .eq("id", party.canonicalPartyId);
      throw error;
    }
  });

  test.afterAll(async () => {
    const errors: unknown[] = [];
    const cleanup = async (
      label: string,
      operation: PromiseLike<SupabaseOperation>,
    ): Promise<void> => {
      try {
        const result = await operation;
        if (result.error)
          errors.push(new Error(`${label}: ${result.error.message}`));
      } catch (error) {
        errors.push(error);
      }
    };

    // Exact dependency order: mappings reference the canonical party.
    await cleanup(
      "party mappings",
      admin.from("party_mapping").delete().in("id", party.mappingIds),
    );
    await cleanup(
      "canonical party",
      admin.from("party_canonical").delete().eq("id", party.canonicalPartyId),
    );
    if (errors.length > 0) {
      throw new AggregateError(errors, "comparison party cleanup failed");
    }
  });

  test("test_mixed_granularity_flagged_in_display_not_only_api", async ({
    page,
  }) => {
    const categoryId = identity.categoryId;
    const [election2023Id, election2025Id] = identity.electionIds;
    if (!election2023Id || !election2025Id) {
      throw new Error("comparison identity is incomplete");
    }

    await withResultFixture(
      SPEC,
      {
        category: { id: categoryId, name: identity.categoryName },
        jurisdictions: [
          {
            id: identity.jurisdictionId,
            distrito_code: identity.distritoCode,
            seccion_code: identity.seccionCode,
          },
        ],
        elections: [
          {
            id: election2023Id,
            year: identity.electionYears[0]!,
            round: identity.electionRounds[0]!,
          },
          {
            id: election2025Id,
            year: identity.electionYears[1]!,
            round: identity.electionRounds[1]!,
          },
        ],
        rows: [
          {
            election_id: election2023Id,
            jurisdiction_id: identity.jurisdictionId,
            category_id: categoryId,
            granularity: "mesa",
            list_id: party.listIds[0]!,
            votes: 10,
            archive_entry_id: identity.archiveEntryIds[0]!,
            source_row_index: 0,
            source_kind: "official",
          },
          {
            election_id: election2025Id,
            jurisdiction_id: identity.jurisdictionId,
            category_id: categoryId,
            granularity: "distrito",
            list_id: party.listIds[1]!,
            votes: 20,
            archive_entry_id: identity.archiveEntryIds[1]!,
            source_row_index: 0,
            source_kind: "official",
          },
        ],
      },
      async () => {
        await page.goto(new URL("/dashboard", baseURL).toString());
        await expect(page).toHaveURL(/\/dashboard/);

        await page
          .getByRole("link", { name: "Comparar resultados electorales" })
          .click();
        await expect(page).toHaveURL(/\/compare$/);
        await page.getByLabel("Elección de 2023").selectOption(election2023Id);
        await page.getByLabel("Elección de 2025").selectOption(election2025Id);
        await page.getByRole("button", { name: "Actualizar opciones" }).click();
        await page.getByLabel("Categoría común").selectOption(categoryId);
        await page.getByRole("button", { name: "Comparar elecciones" }).click();
        await expect(page).toHaveURL(
          new RegExp(
            `/compare\\?election2023=${election2023Id}&election2025=${election2025Id}&categoryId=${categoryId}`,
          ),
        );

        // Next.js also renders its own route-announcer alert, so scope by text.
        const mismatchAlert = page.getByText("Granularidad mixta", {
          exact: false,
        });
        await expect(mismatchAlert).toBeVisible();
        await expect(mismatchAlert).toContainText("mesa");
        await expect(mismatchAlert).toContainText("distrito");
        await expect(mismatchAlert).not.toContainText("aggregateTo");
        await expect(page.getByText("agregado a partir de datos", { exact: false })).toHaveCount(0);
        await expect(page.getByRole("status", { name: /granularidad:/ })).toHaveCount(0);
      },
    );
  });
});
