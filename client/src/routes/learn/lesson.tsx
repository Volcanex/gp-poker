import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTitle } from '../../ui/title.ts';
import { lessonBySlug, nextLesson } from './lessons.ts';
import './learn.css';

/* Every lesson is this shell around a block of .prose: a crumb back to the
   index, the title, the copy, and the two ways out. The order and the
   practice link come from lessons.ts, so a lesson never states where it sits
   in the sequence. */
export function LessonPage({ slug, children }: { slug: string; children: ReactNode }) {
  const lesson = lessonBySlug(slug);
  const next = nextLesson(slug);
  useTitle(lesson?.title ?? 'Learn');

  if (!lesson) return null;

  return (
    <main className="page stack">
      <nav className="crumb">
        <Link to="/learn">Learn</Link>
        <span className="sep" aria-hidden="true">
          /
        </span>
        <span>{lesson.title}</span>
      </nav>

      <h1 className="h1">{lesson.title}</h1>

      <div className="prose">{children}</div>

      <div className="lesson-foot">
        <span>Put it into practice</span>
        <Link className="btn btn-secondary btn-sm" to={lesson.practice.to}>
          {lesson.practice.label}
        </Link>
        <span className="spacer" />
        {next && (
          <span>
            Next: <Link to={`/learn/${next.slug}`}>{next.title}</Link>
          </span>
        )}
      </div>
    </main>
  );
}

/* A diagram with a caption. Lessons draw their figures from the same
   components the app uses, so a card on a lesson page is the card the table
   deals. */
export function Figure({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="figure card">
      <div className="scroll">{children}</div>
      <span className="cap">{caption}</span>
    </div>
  );
}
