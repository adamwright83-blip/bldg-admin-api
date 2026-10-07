const disabledQuery = {
  data: undefined,
  isLoading: false,
  error: null,
};

const disabledMutation = () => ({
  isPending: false,
  mutate: () => undefined,
  mutateAsync: async () => {
    throw new Error("Commercial mission transport is intentionally disabled in the isolated Boreslay gameplay proof.");
  },
});

export const trpc = {
  system: {
    commercialMission: {
      gameState: { useQuery: () => disabledQuery },
      gameStart: { useMutation: disabledMutation },
      gameAbandon: { useMutation: disabledMutation },
      gameComplete: { useMutation: disabledMutation },
    },
  },
};
