HINT_TEXT = {
    "hash table": {
        1: """### Starting hint
A hash table tag only tells you that repeated lookup may matter; it does not tell you what the key should be. Find the exact question the brute force repeats.

### Try this next
Write one sentence naming the lookup key and the information its value must remember.

### Self-check
Would two inputs that share this key always be interchangeable for the remaining work?

### Starter cue
`lookup_key = information_needed_later`""",
        2: """### Directional hint
Use a lookup table only after defining the problem-specific key. The value might be a count, index, group, or best result; derive that from the statement rather than the tag.

### Coding plan
1. Name the repeated lookup performed by the brute-force approach.
2. Choose a canonical key that makes equivalent inputs match.
3. Store only the information required to answer the next lookup.

### Checkpoint
Check whether update order changes the result when the same key appears more than once.""",
        3: """### Algorithm hint
### Core idea
Replace the repeated lookup in the brute-force approach with a table whose key and stored value are derived from the exact statement.

### Steps
1. Identify the repeated question that makes the direct approach slow.
2. Define a canonical lookup key for that question.
3. Query or update the stored count, index, group, or state in the required order.
4. Build the final result from the completed table or the matches found during traversal.

### Edge check
Test duplicate keys and two different inputs that should map to the same key.""",
    },
    "linked list": {
        1: """### Starting hint
Notice that the answer depends on a position inside the linked list, not on sorting or random access. You need pointers that reveal that position while preserving the links.

### Try this next
Decide what `slow`, `fast`, and possibly `prev` should mean before changing any `next` pointer.

### Self-check
When the loop stops, which pointer is on the node you must edit or remove?

### Starter cue
`while fast and fast.next:`""",
        2: """### Directional hint
Two pointers fit because one pointer can measure progress while the other lands on the important node. Keep a previous pointer if the final operation needs relinking.

### Coding plan
1. Initialize the pointers so their distance or speed difference matches the target position.
2. Move them together until the fast pointer reaches the chosen stop condition.
3. Use the slow pointer and previous pointer to perform the link update.

### Checkpoint
Before reconnecting links, confirm what happens when the head itself is the target.""",
        3: """### Algorithm hint
### Core idea
Use two pointers to locate the target node in one traversal, then update the surrounding link cleanly.

### Steps
1. Initialize the pointer setup required by the position you need to find.
2. Move the pointers until the fast pointer reaches the stop condition that proves slow is correctly placed.
3. Use the pointer before the target to reconnect the list around the target node.
4. Return the correct head, including the case where the original head changed.

### Edge check
Test a one-node list or a case where the head is removed.""",
    },
    "binary search": {
        1: """### Starting hint
Notice whether the problem has a sorted range, monotonic condition, or answer space where once something becomes true it stays true. That is the real reason binary search may apply.

### Try this next
Write down what `left` and `right` mean in this problem, then write the middle candidate.

### Self-check
If you test `mid`, can you prove which side can be discarded?

### Starter cue
`mid = left + (right - left) // 2`""",
        2: """### Directional hint
Binary search fits only if your check on `mid` is monotonic. The goal is to turn the problem into a yes/no test that safely eliminates half.

### Coding plan
1. Define the meaning of the search bounds in words.
2. Write the condition that tests whether `mid` is too small, too large, or valid.
3. Update exactly one bound in each branch so the interval shrinks.

### Checkpoint
Can your loop get stuck when only two candidates remain?""",
        3: """### Algorithm hint
### Core idea
Binary search works when one test on the middle candidate tells you which half of the remaining search space is still valid.

### Steps
1. Set the low and high boundaries of the valid search space.
2. Compute the middle candidate each round.
3. Evaluate the middle candidate and discard the invalid half.
4. Stop when the bounds converge or the exact target is found, depending on the problem goal.

### Edge check
Test the smallest input and a case where the answer is at the boundary.""",
    },
    "dynamic programming": {
        1: """### Starting hint
Notice whether the same smaller decisions repeat across the problem. DP starts by naming exactly what one saved answer means.

### Try this next
Before transitions, write a sentence for `dp[i]` or `dp[i][j]` in terms of the input.

### Self-check
Can you explain one DP cell without saying 'the answer so far' vaguely?

### Starter cue
`dp[i] = best answer using the first i positions/items`""",
        2: """### Directional hint
DP fits when the answer for a larger prefix/state can be built from earlier states. The hard part is choosing a state that contains enough information but not too much.

### Coding plan
1. Define the DP state in one precise sentence.
2. List the previous states that can transition into the current state.
3. Choose a fill order where those previous states are already computed.

### Checkpoint
If two different histories lead to the same DP state, do they need the same future information?""",
        3: """### Algorithm hint
### Core idea
Store answers for smaller states and reuse them so repeated subproblems are solved once.

### Steps
1. Define the DP state so each entry has one clear meaning.
2. Set the base cases from the smallest valid inputs.
3. Write the transition using only states that are already known.
4. Return the state that represents the complete input.

### Edge check
Test the smallest input because DP bugs usually start in base cases.""",
    },
    "graph": {
        1: """### Starting hint
Notice what a single state represents in {title}: a node, position, index, mask, or configuration. Once the state is clear, traversal becomes much less mysterious.

### Try this next
Write what counts as a neighbor from one state before choosing BFS or DFS.

### Self-check
Could the same state be reached twice? If yes, what identifies it uniquely?

### Starter cue
`visited.add(state)`""",
        2: """### Directional hint
Graph traversal fits when the problem is about moving between valid states. Use BFS for shortest steps and DFS for reachability or full exploration.

### Coding plan
1. Define the state and how to generate its neighbors.
2. Initialize the queue or stack with the starting state.
3. Mark visited states consistently so cycles or repeated paths do not explode.

### Checkpoint
Mark a state when you enqueue/push it unless the problem specifically needs a different timing.""",
        3: """### Algorithm hint
### Core idea
Model valid positions or configurations as states, then traverse each reachable state once.

### Steps
1. Define what one state contains.
2. Generate all valid neighbors from that state.
3. Traverse with BFS or DFS while preventing revisits.
4. Return the distance, count, or found condition required by the problem.

### Edge check
Test a case with a cycle, blocked move, or repeated state.""",
    },
    "clock": {
        1: """### Starting hint
Notice that both clock hands can be converted into angles from 12 o'clock. The hour hand also moves while minutes pass, so it is not just `30 * hour`.

### Try this next
Compute the minute angle and hour angle separately before comparing them.

### Self-check
Does your hour angle change when `minutes` changes?

### Starter cue
`minute_angle = 6 * minutes; hour_angle = 30 * (hour % 12) + 0.5 * minutes`""",
        2: """### Directional hint
This is a formula problem: compute both hand angles, then handle the circular distance. The final comparison is between the direct gap and the wraparound gap.

### Coding plan
1. Convert minutes to degrees using 6 degrees per minute.
2. Convert hours to degrees and add the extra minute movement.
3. Take the smaller of `diff` and `360 - diff`.

### Checkpoint
Treat `12` like `0` on the clock face.""",
        3: """### Algorithm hint
### Core idea
Turn the problem into two angle computations, then take the smaller circular distance between them.

### Steps
1. Convert the minute value into the minute-hand angle.
2. Convert the hour and minute values into the hour-hand angle, including minute movement.
3. Compute the absolute difference between the two angles.
4. Return the smaller value between that difference and the full-circle complement.

### Edge check
Test `12:00`, because both hands should produce angle `0`.""",
    },
    "math": {
        1: """### Starting hint
Notice which quantities actually change and which are fixed by the input. Math and simulation problems become easier when each changing quantity gets its own formula or update rule.

### Try this next
Name the first value you can compute directly from the input before combining everything.

### Self-check
Are all quantities using the same units and indexing convention?

### Starter cue
`value_after_step = previous_value + current_contribution`""",
        2: """### Directional hint
Break the problem into the few quantities that change, compute each separately, and combine them at the end. Handle wraparound, bounds, or formatting after the main calculation.

### Coding plan
1. List the changing quantities and their starting values.
2. Write the update rule for one step or one input item.
3. Apply the final adjustment requested by the statement.

### Checkpoint
Check units, indexing, and whether the answer needs min/max or wraparound handling.""",
        3: """### Algorithm hint
### Core idea
Compute the core quantities directly from the input, then apply the final comparison or adjustment the statement requires.

### Steps
1. Identify the exact values that can be computed directly from the input.
2. Write the formula or update rule for each value separately.
3. Combine those values to produce the raw answer.
4. Apply any final minimization, wraparound, or formatting rule before returning.

### Edge check
Test a boundary value such as zero, one item, or a maximum/minimum input.""",
    },
    "general": {
        1: """### Starting hint
{starting_line} Then ask what information you wish you already knew before making the next decision.

### Try this next
Write down the repeated decision in the problem, then name the state that would make that decision easier.

### Self-check
After one element or step, what changes and what must stay remembered?

### Starter cue
`track_the_state_you_need_before_the_next_step`""",
        2: """### Directional hint
Focus on the repeated decision in the problem and decide what must be tracked before moving forward. Once that tracked state is clear, the flow usually becomes one pass, ordered traversal, search, or DP.

### Coding plan
1. State the repeated decision in plain English.
2. Choose the smallest state or helper structure that answers that decision.
3. Process the input in the order that keeps the state useful.

### Checkpoint
You should be able to explain what changes after every step and why that helps the next step.""",
        3: """### Algorithm hint
### Core idea
Identify the minimum state or helper structure that removes repeated work, then process the input in the order that keeps that state useful.

### Steps
1. Identify the exact state or helper structure you need to maintain.
2. Process the input in the order that makes earlier work reusable.
3. Update that state after each step according to the current element or condition.
4. Return the final value once the traversal, search, or construction is complete.

### Edge check
Test the smallest valid input and one case where the obvious greedy choice might fail.""",
    },
}
