# Image Generation

## Product priority

Optimise in this order:

1. Correct child identity
2. Correct character count and assignment
3. Clothing and object continuity
4. Age-appropriate emotional tone
5. Style consistency
6. Mobile clarity
7. Visual beauty
8. Speed
9. Cost

## Character identity

Character identity is a versioned approved asset set, not a prose prompt.

Each character profile should include:

- front portrait
- three-quarter portrait
- full-body front
- side view
- expression references
- default outfit
- scale comparison

Generate additional views from the approved candidate rather than independently from the original description.

## Art Bible

The first MVP supports one approved style.

Recommended qualities:

- premium digital gouache
- warm expressive lighting
- gentle storybook proportions
- clear faces
- rich but uncluttered backgrounds
- no photorealism
- no glossy 3D
- no named living-artist imitation
- no text rendered in the image

## Story visual profile

Every story pins:

- character visual versions
- Art Bible version
- location visual versions
- image route version

Existing series do not change automatically.

## Illustration plan

The text model produces a model-neutral `IllustrationSpec`. It describes:

- scene
- placement
- character positions
- expressions
- outfits
- environment
- camera
- lighting
- required elements
- forbidden elements
- continuity notes

Application code selects actual reference assets and builds the provider prompt.

## Reference selection priority

1. Identity reference for each child
2. Second angle for prominent child
3. Outfit reference
4. Plot-critical prop
5. Location reference
6. Style reference
7. Supporting character
8. Decorative object

Never omit one child’s identity reference to include scenery.

## Generation and review

```text
Prepare references
→ Generate
→ Upload quarantined original
→ Technical validation
→ Vision review
→ Approve
  or targeted repair
  or premium escalation
  or manual review
```

Rejected images never appear in reader APIs.

## Targeted repair

Repair instructions preserve valid composition and correct specific failures.

Default maximum:

- initial attempt
- one targeted repair
- one premium escalation
- then manual review or pending state

## Storage

Store approved originals privately. Create responsive AVIF/WebP derivatives. Retain lineage to prompt builder, references, model, review, and chapter revision.

## Mobile

Default chapter ratio: 4:3.  
Default cover ratio: 2:3.  
Routine resolution: 2K.

Important faces and objects must remain clear at phone size.

## Privacy

The MVP does not require photographs and does not create biometric face embeddings.

## Acceptance criteria

- Parents approve canonical reference sets.
- Wrong identity and wrong count are blocking.
- Visual profiles are immutable per series.
- Text may publish while non-lead images are pending.
