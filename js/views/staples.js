import { getStaples, STAPLES_TAG } from "../api.js";
import { state } from "../state.js";

// Opens the household staples list for editing, or starts a new one the first time.
export async function render() {
  const existing = await getStaples();
  if (existing) { location.replace(`#/edit/${existing.id}`); return; }
  state.draft = { title: "Household staples", tags: [STAPLES_TAG], servings: 1, source: "manual", ingredients: [], steps: [] };
  state.draftPhoto = null; state.draftPhotoFromWeb = false;
  location.replace("#/edit/new");
}
