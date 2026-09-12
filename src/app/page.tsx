import { Suspense } from 'react';
import { WorkoutApp } from '@/components/workout-app';
import { AppSkeleton } from '@/components/app-skeleton';

export default function Home() {
  return (
    <Suspense fallback={<AppSkeleton />}>
      <WorkoutApp />
    </Suspense>
  );
}
