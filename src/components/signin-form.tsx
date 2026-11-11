    // Sellers land in the Seller Hub (or in onboarding if they have not opened
    // a shop yet), buyers on the storefront. `postAuthDestination` asks the
    // database — the profile role and the `shops` row together, via the shared
    // `isBuyerAccount` rule — so a seller who has not started onboarding is not
    // mistaken for a buyer, and a buyer who owns a shop is not mistaken for a
    // seller. An explicit `?next=` always wins.
