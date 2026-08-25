A few things I want us to clarify/change before we lock the WBS:

Main thing: 
Scoring, not RISKY / NOT_RISKY
    
This is the biggest change. CopySight shouldn’t become a binary safe/not-safe gate.
    
We need to preserve the actual CopyScore scoring/results and let the integration/application decide what to do with them.
1-100 
 
Ideally the blockchain record contains:
- CopySight score / similarity
detected IP/
category
IP Owner 
Artist 
model version
analysis hash
timestamp

We can still return 1-100 score,  LOW / MEDIUM / HIGH for UX, but it should be derived from the score and configurable — not hardcoded into the smart contract.

Let’s optimize for the Soneium sandbox demo first
The immediate goal is not to build the final blockchain infrastructure. The goal is to get a compelling working integration in front of Sony/Soneium quickly and use it to move the partnership/client conversation forward.

What exactly will we be able to demonstrate at the 2-week milestone?

I want the simplest end-to-end flow:
    
Upload asset → CopySight analysis → score/result → hash → Soneium attestation → transaction confirmed → provenance/score visible back in CopySight.

What can we cut from the first 2 weeks?
    
Let’s identify anything that isn’t necessary for the Sony/Soneium sandbox demo and push it into 
Phase 2.
    
For example, do we actually need the custom CopySightResolver for the first sandbox? Do we need both Creation and Validation schemas immediately? 

Proof of Creation vs IP Scoring
    
I see these as two connected but separate things:
    
Proof of Creation: “This asset existed and was analyzed by 
CopySight at this time.”
    
IP Risk/Similarity: “This is what CopySight found and scored at that time.”
    
Let’s make sure the architecture keeps those concepts separate rather than turning Proof of Creation into a claim that the asset is “safe.”

What exactly goes on-chain?
    
My preference is minimal public data: asset hash + CopySight analysis hash + score/result + analysis version + timestamp/attestation.
    
Detailed CopySight findings can remain off-chain and be retrieved from CopySight.
    
Please recommend the minimum useful on-chain schema for the sandbox.

Portability
    
I like the idea that this becomes reusable infrastructure beyond Soneium.
    
Please make sure the Soneium-specific blockchain adapter is separated from the CopySight scoring/validation logic so later we can deploy the same module to other EVM chains without rebuilding the system.

CopySight engineering dependency
    
Please define exactly what you need from our team:
which engineer(s)
approximate hours
what APIs/access

We need to keep the burden on the core team minimal.

2-week acceptance criteria
    
I want us to be able to say objectively: yes, the Soneium sandbox demo works.
September milestone
    
Same for the end-of-September MVP. Let’s  separate:
sandbox/demo
tested MVPl production/mainnet readiness
    
These don’t need to be the same thing.

Ownership / handoff
    
All code, schemas, contracts, deployment scripts and documentation should live in / be transferred to CopySight-controlled repositories and be reusable by CopySight after the project.

Soneium questions
Let’s also create a short list of things we need directly from the Soneium technical team so we don’t spend development time guessing their architecture or requirements.

Don’t overbuild it. Build the smallest technically credible Soneium integration that demonstrates CopySight scoring + Proof of Creation end-to-end, gets Sony excited, and gives us an architecture we can expand after the sandbox succeeds.