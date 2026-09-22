import { STORIES } from "./catalogue.tsx";
import "./Stories.css";

// DESIGN.md §9: every component's stories, mounted instead of the app when a debug build is opened with `#stories`
// (main.tsx). The theme is the window's, as everywhere; stories.e2e.ts flips it and screenshots both.

export function Stories() {
  return (
    <main className="ui-stories">
      <h1>Components</h1>
      {STORIES.map((story) => (
        <section key={story.component} className="ui-stories-component" data-component={story.component}>
          <h2>{story.component}</h2>
          {story.states.map((state) => (
            <div key={state.name} className="ui-story" data-story={`${story.component}/${state.name}`}>
              <span className="ui-story-name">{state.name}</span>
              <div>{state.node}</div>
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
