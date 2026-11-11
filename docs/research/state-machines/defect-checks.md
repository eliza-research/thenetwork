# Wave 1 defect checks

> Superseded. A follow-up run checked the 157 candidates with fewer than two votes. The final verdict for all 510 candidates is in the Verdict column of [the register](../2026-11-07-state-machines.md#5-suspected-defect-register) and in [defect-verdicts.json](defect-verdicts.json): 225 confirmed, 134 disputed, 151 refuted. This table keeps the first run's votes as a record.

The Nov. 7, 2026 Claude Code workflow checked the [suspected-defect register](../2026-11-07-state-machines.md#5-suspected-defect-register) against commit `a0ed7bc`. Two agents independently tried to refute each candidate using different review instructions. The run stopped before it wrote a final register. This table records the 708 structured votes that the workflow saved.

| Paired result | Candidates |
|---|---:|
| Neither check refuted the candidate | 170 |
| Both checks refuted the candidate | 96 |
| The checks disagreed | 87 |
| One check returned a vote | 2 |
| No check returned a vote | 155 |
| Total | 510 |

Treat these votes as triage evidence. A failure to refute can come from code reading alone. Review the code and reproduce the trigger before calling a defect confirmed. A dash means the workflow saved no vote for that check. The table omits the 155 candidates with zero votes.

| Defect | Check 1 | Check 2 |
|---|---|---|
| SD-001 | Did not refute | Did not refute |
| SD-002 | Did not refute | Did not refute |
| SD-003 | Did not refute | Did not refute |
| SD-004 | Did not refute | Refuted |
| SD-005 | Did not refute | Did not refute |
| SD-006 | Did not refute | Did not refute |
| SD-007 | Refuted | Refuted |
| SD-008 | Did not refute | Did not refute |
| SD-009 | Did not refute | Did not refute |
| SD-010 | Did not refute | Did not refute |
| SD-011 | Did not refute | Did not refute |
| SD-012 | Refuted | Refuted |
| SD-013 | Did not refute | Did not refute |
| SD-014 | Did not refute | Did not refute |
| SD-015 | Did not refute | Did not refute |
| SD-016 | Did not refute | Did not refute |
| SD-017 | Did not refute | Refuted |
| SD-018 | Refuted | Refuted |
| SD-019 | Did not refute | Did not refute |
| SD-020 | Did not refute | Did not refute |
| SD-021 | Did not refute | Did not refute |
| SD-022 | Did not refute | Did not refute |
| SD-023 | Did not refute | Did not refute |
| SD-024 | Did not refute | Did not refute |
| SD-025 | Did not refute | Did not refute |
| SD-026 | Did not refute | Refuted |
| SD-027 | Did not refute | Did not refute |
| SD-028 | Did not refute | Refuted |
| SD-029 | Did not refute | Did not refute |
| SD-030 | Did not refute | Did not refute |
| SD-031 | Did not refute | Did not refute |
| SD-032 | Refuted | Did not refute |
| SD-033 | Did not refute | Did not refute |
| SD-034 | Refuted | Refuted |
| SD-035 | Did not refute | Did not refute |
| SD-036 | Did not refute | Did not refute |
| SD-037 | Did not refute | Did not refute |
| SD-038 | Did not refute | Did not refute |
| SD-039 | Did not refute | Did not refute |
| SD-040 | Did not refute | Refuted |
| SD-041 | Did not refute | Did not refute |
| SD-042 | Did not refute | Did not refute |
| SD-043 | Did not refute | Did not refute |
| SD-044 | Did not refute | Did not refute |
| SD-045 | Did not refute | Did not refute |
| SD-046 | Did not refute | Did not refute |
| SD-047 | Did not refute | Refuted |
| SD-048 | Did not refute | Did not refute |
| SD-049 | Did not refute | Refuted |
| SD-050 | Did not refute | Refuted |
| SD-051 | Did not refute | Refuted |
| SD-052 | Did not refute | Refuted |
| SD-053 | Did not refute | Refuted |
| SD-054 | Did not refute | Refuted |
| SD-055 | Did not refute | Refuted |
| SD-056 | Did not refute | Did not refute |
| SD-057 | Refuted | Refuted |
| SD-058 | Did not refute | Did not refute |
| SD-059 | Refuted | Refuted |
| SD-060 | Refuted | Did not refute |
| SD-061 | Did not refute | Did not refute |
| SD-062 | Refuted | Refuted |
| SD-063 | Did not refute | Refuted |
| SD-064 | Did not refute | Did not refute |
| SD-065 | Did not refute | Did not refute |
| SD-066 | Did not refute | Did not refute |
| SD-067 | Did not refute | Did not refute |
| SD-068 | Did not refute | Did not refute |
| SD-069 | Refuted | Refuted |
| SD-070 | Did not refute | Did not refute |
| SD-071 | Did not refute | Did not refute |
| SD-072 | Did not refute | Refuted |
| SD-073 | Did not refute | Did not refute |
| SD-074 | Did not refute | Refuted |
| SD-075 | Did not refute | Did not refute |
| SD-076 | Did not refute | Did not refute |
| SD-077 | Did not refute | Did not refute |
| SD-078 | Did not refute | Did not refute |
| SD-079 | Refuted | Refuted |
| SD-080 | Did not refute | Did not refute |
| SD-081 | Refuted | Refuted |
| SD-082 | Did not refute | Did not refute |
| SD-083 | Did not refute | Did not refute |
| SD-084 | Did not refute | Did not refute |
| SD-085 | Refuted | Refuted |
| SD-086 | Refuted | Refuted |
| SD-087 | Did not refute | Did not refute |
| SD-088 | Refuted | Refuted |
| SD-089 | Did not refute | Did not refute |
| SD-090 | Did not refute | Did not refute |
| SD-091 | Did not refute | Did not refute |
| SD-092 | Did not refute | Did not refute |
| SD-093 | Refuted | Refuted |
| SD-094 | Did not refute | Refuted |
| SD-095 | Did not refute | Refuted |
| SD-096 | Did not refute | Did not refute |
| SD-097 | Did not refute | Did not refute |
| SD-098 | Did not refute | Did not refute |
| SD-099 | Refuted | Refuted |
| SD-100 | Did not refute | Did not refute |
| SD-101 | Did not refute | Did not refute |
| SD-102 | Refuted | Refuted |
| SD-103 | Refuted | Refuted |
| SD-104 | Did not refute | Did not refute |
| SD-105 | Did not refute | Did not refute |
| SD-106 | Refuted | Refuted |
| SD-107 | Did not refute | Refuted |
| SD-108 | Did not refute | Refuted |
| SD-109 | Refuted | Refuted |
| SD-110 | Did not refute | Refuted |
| SD-111 | Did not refute | Refuted |
| SD-112 | Did not refute | Refuted |
| SD-113 | Did not refute | Did not refute |
| SD-114 | Did not refute | Did not refute |
| SD-115 | Did not refute | Did not refute |
| SD-116 | Refuted | Refuted |
| SD-117 | Did not refute | Refuted |
| SD-118 | Did not refute | Refuted |
| SD-119 | Refuted | Refuted |
| SD-120 | Did not refute | Refuted |
| SD-121 | Did not refute | Refuted |
| SD-122 | Did not refute | Did not refute |
| SD-123 | Refuted | Refuted |
| SD-124 | Did not refute | Refuted |
| SD-125 | Did not refute | Did not refute |
| SD-126 | Did not refute | Did not refute |
| SD-127 | Did not refute | Did not refute |
| SD-128 | Refuted | Refuted |
| SD-129 | Did not refute | Refuted |
| SD-130 | Refuted | Refuted |
| SD-131 | Did not refute | Did not refute |
| SD-132 | Did not refute | Did not refute |
| SD-133 | Did not refute | Did not refute |
| SD-134 | Refuted | Refuted |
| SD-135 | Did not refute | Did not refute |
| SD-136 | Did not refute | Refuted |
| SD-137 | Did not refute | Did not refute |
| SD-138 | Did not refute | Did not refute |
| SD-139 | Did not refute | Did not refute |
| SD-140 | Did not refute | Did not refute |
| SD-141 | Did not refute | Did not refute |
| SD-142 | Did not refute | Refuted |
| SD-143 | Did not refute | Did not refute |
| SD-144 | Did not refute | Did not refute |
| SD-145 | Refuted | Refuted |
| SD-146 | Did not refute | Refuted |
| SD-147 | Did not refute | Did not refute |
| SD-148 | Did not refute | Refuted |
| SD-149 | Refuted | Refuted |
| SD-150 | Did not refute | Refuted |
| SD-151 | Did not refute | Did not refute |
| SD-152 | Did not refute | Refuted |
| SD-153 | Did not refute | Did not refute |
| SD-154 | Did not refute | Did not refute |
| SD-155 | Refuted | Refuted |
| SD-156 | Did not refute | Refuted |
| SD-157 | Refuted | Refuted |
| SD-158 | Did not refute | Refuted |
| SD-159 | Did not refute | Did not refute |
| SD-160 | Refuted | Refuted |
| SD-161 | Did not refute | Did not refute |
| SD-162 | Did not refute | Refuted |
| SD-163 | Did not refute | Did not refute |
| SD-164 | Did not refute | Refuted |
| SD-165 | Did not refute | Did not refute |
| SD-166 | Did not refute | Did not refute |
| SD-167 | Did not refute | Did not refute |
| SD-168 | Did not refute | Did not refute |
| SD-169 | Did not refute | Did not refute |
| SD-170 | Did not refute | Refuted |
| SD-171 | Refuted | Refuted |
| SD-172 | Did not refute | Refuted |
| SD-173 | Refuted | Refuted |
| SD-174 | Refuted | Refuted |
| SD-175 | Did not refute | Refuted |
| SD-176 | Did not refute | Did not refute |
| SD-177 | Refuted | Refuted |
| SD-178 | Did not refute | Did not refute |
| SD-179 | Did not refute | Did not refute |
| SD-180 | Refuted | Refuted |
| SD-181 | Did not refute | Did not refute |
| SD-182 | Did not refute | Refuted |
| SD-183 | Refuted | Refuted |
| SD-184 | Did not refute | Did not refute |
| SD-185 | Did not refute | Did not refute |
| SD-186 | Did not refute | Refuted |
| SD-187 | Refuted | Refuted |
| SD-188 | Did not refute | Did not refute |
| SD-189 | Did not refute | Refuted |
| SD-190 | Did not refute | Did not refute |
| SD-191 | Refuted | Refuted |
| SD-192 | Refuted | Refuted |
| SD-193 | Did not refute | Refuted |
| SD-194 | Did not refute | Did not refute |
| SD-195 | Did not refute | Did not refute |
| SD-196 | Refuted | Refuted |
| SD-197 | Refuted | Refuted |
| SD-198 | Refuted | Refuted |
| SD-199 | Refuted | Refuted |
| SD-200 | Refuted | Refuted |
| SD-201 | Did not refute | Did not refute |
| SD-202 | Refuted | Refuted |
| SD-203 | Refuted | Refuted |
| SD-204 | Did not refute | Did not refute |
| SD-205 | Refuted | Refuted |
| SD-206 | Did not refute | Did not refute |
| SD-207 | Did not refute | Refuted |
| SD-208 | Refuted | Refuted |
| SD-209 | Did not refute | Did not refute |
| SD-210 | Refuted | Did not refute |
| SD-211 | Refuted | Refuted |
| SD-212 | Did not refute | Did not refute |
| SD-213 | Did not refute | Did not refute |
| SD-214 | Did not refute | Did not refute |
| SD-215 | Did not refute | Did not refute |
| SD-216 | Did not refute | Refuted |
| SD-217 | Did not refute | Did not refute |
| SD-218 | Did not refute | Did not refute |
| SD-219 | Did not refute | Refuted |
| SD-220 | Did not refute | Did not refute |
| SD-221 | Did not refute | Refuted |
| SD-222 | Did not refute | Did not refute |
| SD-223 | Did not refute | Did not refute |
| SD-224 | Did not refute | Refuted |
| SD-225 | Did not refute | Did not refute |
| SD-226 | Did not refute | Refuted |
| SD-227 | Did not refute | Did not refute |
| SD-228 | Did not refute | Refuted |
| SD-229 | Did not refute | Did not refute |
| SD-230 | Refuted | Refuted |
| SD-231 | Refuted | Refuted |
| SD-232 | Refuted | Refuted |
| SD-233 | Did not refute | Refuted |
| SD-234 | Refuted | Refuted |
| SD-235 | Did not refute | Did not refute |
| SD-236 | Did not refute | Did not refute |
| SD-237 | Did not refute | Refuted |
| SD-238 | Refuted | Refuted |
| SD-239 | Did not refute | Refuted |
| SD-240 | Did not refute | Refuted |
| SD-241 | Refuted | Refuted |
| SD-242 | Refuted | Refuted |
| SD-243 | Refuted | Refuted |
| SD-244 | Did not refute | Did not refute |
| SD-245 | Did not refute | Did not refute |
| SD-246 | Did not refute | Did not refute |
| SD-247 | Did not refute | Did not refute |
| SD-248 | Did not refute | Did not refute |
| SD-249 | Did not refute | Refuted |
| SD-250 | Did not refute | Did not refute |
| SD-251 | Refuted | Refuted |
| SD-252 | Did not refute | Refuted |
| SD-253 | Refuted | Did not refute |
| SD-254 | Did not refute | Refuted |
| SD-255 | Did not refute | Refuted |
| SD-256 | Did not refute | Did not refute |
| SD-257 | Did not refute | Refuted |
| SD-258 | Refuted | Refuted |
| SD-259 | Did not refute | Did not refute |
| SD-260 | Did not refute | Refuted |
| SD-261 | Refuted | Refuted |
| SD-262 | Did not refute | Did not refute |
| SD-263 | Did not refute | Refuted |
| SD-264 | Did not refute | Did not refute |
| SD-265 | Refuted | Refuted |
| SD-266 | Did not refute | Did not refute |
| SD-267 | Did not refute | Refuted |
| SD-268 | Did not refute | Did not refute |
| SD-269 | Did not refute | Did not refute |
| SD-270 | Refuted | Refuted |
| SD-271 | Refuted | Refuted |
| SD-272 | Refuted | Refuted |
| SD-273 | Refuted | Refuted |
| SD-274 | Refuted | Refuted |
| SD-275 | Did not refute | Did not refute |
| SD-276 | Did not refute | Did not refute |
| SD-277 | Refuted | Refuted |
| SD-278 | Did not refute | Did not refute |
| SD-279 | Refuted | Did not refute |
| SD-280 | Refuted | Refuted |
| SD-281 | Did not refute | Did not refute |
| SD-282 | Did not refute | Did not refute |
| SD-283 | Did not refute | Did not refute |
| SD-284 | Did not refute | Did not refute |
| SD-285 | Did not refute | Refuted |
| SD-286 | Did not refute | Refuted |
| SD-287 | Did not refute | Did not refute |
| SD-288 | Did not refute | Refuted |
| SD-289 | Refuted | Refuted |
| SD-290 | Did not refute | Did not refute |
| SD-291 | Did not refute | Did not refute |
| SD-292 | Refuted | Refuted |
| SD-293 | Did not refute | Refuted |
| SD-294 | Did not refute | Refuted |
| SD-295 | Refuted | Refuted |
| SD-296 | Did not refute | Did not refute |
| SD-297 | Did not refute | Did not refute |
| SD-298 | Refuted | Refuted |
| SD-299 | Did not refute | Did not refute |
| SD-300 | Did not refute | Refuted |
| SD-301 | Did not refute | Refuted |
| SD-302 | Refuted | Refuted |
| SD-303 | Did not refute | Did not refute |
| SD-304 | Did not refute | Refuted |
| SD-305 | Refuted | Refuted |
| SD-306 | Refuted | Refuted |
| SD-307 | Refuted | Refuted |
| SD-308 | Did not refute | Refuted |
| SD-309 | Refuted | Refuted |
| SD-310 | Refuted | Refuted |
| SD-311 | Refuted | Refuted |
| SD-312 | Refuted | Refuted |
| SD-313 | Did not refute | Did not refute |
| SD-314 | Did not refute | Did not refute |
| SD-315 | Did not refute | Did not refute |
| SD-316 | Did not refute | Refuted |
| SD-317 | Did not refute | Did not refute |
| SD-318 | Did not refute | Did not refute |
| SD-319 | Refuted | Refuted |
| SD-320 | Did not refute | Did not refute |
| SD-321 | Refuted | Refuted |
| SD-322 | Did not refute | Did not refute |
| SD-323 | Refuted | Refuted |
| SD-324 | Did not refute | Did not refute |
| SD-325 | Did not refute | Did not refute |
| SD-326 | Refuted | Refuted |
| SD-327 | Did not refute | Refuted |
| SD-328 | Did not refute | Did not refute |
| SD-329 | Did not refute | Refuted |
| SD-330 | Did not refute | Did not refute |
| SD-331 | Refuted | Refuted |
| SD-332 | Refuted | Refuted |
| SD-333 | Refuted | Refuted |
| SD-334 | Did not refute | Did not refute |
| SD-335 | Refuted | Refuted |
| SD-336 | Did not refute | Did not refute |
| SD-337 | Did not refute | Refuted |
| SD-338 | Did not refute | Did not refute |
| SD-339 | Did not refute | Refuted |
| SD-340 | Refuted | Refuted |
| SD-341 | Did not refute | Did not refute |
| SD-342 | Did not refute | Did not refute |
| SD-343 | Refuted | Refuted |
| SD-344 | Refuted | Refuted |
| SD-345 | Refuted | Refuted |
| SD-346 | Refuted | Refuted |
| SD-347 | Refuted | Refuted |
| SD-348 | Did not refute | Refuted |
| SD-349 | Refuted | Refuted |
| SD-350 | Did not refute | Did not refute |
| SD-351 | Refuted | Refuted |
| SD-352 | — | Refuted |
| SD-354 | Did not refute | Refuted |
| SD-355 | Did not refute | Refuted |
| SD-357 | Refuted | — |
