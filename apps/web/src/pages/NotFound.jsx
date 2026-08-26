import { useDispatch } from 'react-redux';
import { Button, Section } from '../components/ui/index.jsx';
import { openPanel } from '../features/sakha/sakhaSlice.js';
import Seo from '../components/layout/Seo.jsx';

export default function NotFound() {
  const dispatch = useDispatch();
  return (
    <>
      <Seo title="Page not found" noindex />
      <Section>
        <div className="mx-auto max-w-lg py-20 text-center">
          <p className="font-mono text-sm text-subtle">404</p>
          <h1 className="mt-4 text-3xl">That page does not exist.</h1>
          <p className="mt-4 leading-relaxed text-muted">
            It may have moved, or it may never have existed. Sakha knows the whole site — she can
            probably point you at the right one.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button to="/" variant="accent">Back to the homepage</Button>
            <Button variant="outline" onClick={() => dispatch(openPanel())}>Ask Sakha</Button>
          </div>
        </div>
      </Section>
    </>
  );
}
