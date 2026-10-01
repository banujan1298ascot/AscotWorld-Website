import { redirect } from "next/navigation";

/** The table view used to be its own page while it was on trial; it's now a
 *  view of the MES page. Kept so old links and bookmarks still land on it. */
export default function MesTableRedirect() {
  redirect("/mes?view=table");
}
