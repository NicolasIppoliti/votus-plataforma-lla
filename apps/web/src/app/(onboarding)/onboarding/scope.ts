import "server-only";
import { createAuthorizedOfficialFacetRepository } from "@/lib/workspace/official-facets";

/** Full authorized overview, with parent identities retained for every territory.
 * Sequential traversal bounds concurrent RPCs. Nothing is cached across sessions.
 */
export async function loadOnboardingScope() {
  const repository = createAuthorizedOfficialFacetRepository();
  const root = await repository.facets({});
  const elections = [];
  for (const election of root.elections) {
    const available = await repository.facets({ electionId: election.id });
    const categories = [];
    for (const category of available.categories) {
      const parent = { electionId: election.id, categoryId: category.id };
      const districts = await repository.facets(parent);
      const territories = [];
      for (const district of districts.distritos) {
        const sections = await repository.facets({ ...parent, distritoCode: district.code });
        territories.push({ district, sections: sections.secciones, exclusions: sections.exclusions });
      }
      categories.push({ category, territories, exclusions: districts.exclusions });
    }
    elections.push({ election, categories, exclusions: available.exclusions });
  }
  return { elections, exclusions: root.exclusions };
}
