import { map } from "lodash"
import * as moment from "moment";
import { getRepository } from "typeorm"
import { NextFunction, Request, Response } from "express"
import { Roll } from "../entity/roll.entity"
import { Group } from "../entity/group.entity"
import { Student } from "../entity/student.entity"
import { GroupStudent } from "../entity/group-student.entity"
import { StudentRollState } from "../entity/student-roll-state.entity"
import { CreateGroupInput, UpdateGroupInput } from "../interface/group.interface"
import { CreateGroupStudentInput } from "../interface/group-student.interface"
import { ResourceNotFoundError } from "../utils/errors"

export class GroupController {
  private groupRepository = getRepository(Group)
  private groupStudentRepository = getRepository(GroupStudent)
  private studentRollStateRepository = getRepository(StudentRollState)

  async allGroups(request: Request, response: Response, next: NextFunction) {
    return this.groupRepository.find()
  }

  async createGroup(request: Request, response: Response, next: NextFunction) {    
    const { body: params } = request

    const createGroupInput: CreateGroupInput = {
      name: params.name,
      number_of_weeks: params.number_of_weeks,
      roll_states: params.roll_states,
      incidents: params.incidents,
      ltmt: params.ltmt,
    }
    const group = new Group()
    group.prepareToCreate(createGroupInput)
    
    return this.groupRepository.save(group)
  }

  async updateGroup(request: Request, response: Response, next: NextFunction) {
    const { body: params } = request

    const group = await this.groupRepository.findOne(params.id)
    if (group == undefined) {
      return new ResourceNotFoundError      
    }

    const updateGroupInput: UpdateGroupInput = {
      id: params.id,
      name: params.name,
      number_of_weeks: params.number_of_weeks,
      roll_states: params.roll_states,
      incidents: params.incidents,
      ltmt: params.ltmt,
      run_at: undefined,
      student_count: undefined,
    }
    group.prepareToUpdate(updateGroupInput)

    return this.groupRepository.save(group)
  }

  async removeGroup(request: Request, response: Response, next: NextFunction) {    
    let groupToRemove = await this.groupRepository.findOne(request.params.id)
    if (groupToRemove == undefined) {
      return new ResourceNotFoundError
    }

    return this.groupRepository.remove(groupToRemove)
  }

  async getGroupStudents(request: Request, response: Response, next: NextFunction) {    
    const { params: params } = request
    
    return this.groupStudentRepository
    .createQueryBuilder('group_student')
    .select('group_student.student_id', 'id')        
    .addSelect('s.first_name', 'first_name')
    .addSelect('s.last_name', 'last_name')
    .addSelect('s.first_name || " " || s.last_name', 'full_name')
    .innerJoin(Group, 'g', 'group_student.group_id = g.id')
    .innerJoin(Student, 's', 'group_student.student_id = s.id')        
    .where("group_student.group_id = :group_id", { group_id: params.group_id })
    .getRawMany()
  }


  async runGroupFilters(request: Request, response: Response, next: NextFunction) {
    // delete all the students from the groups
    await this.groupStudentRepository.clear()    
    
    // for each group, query the student rolls to see which students match the filter for the group
    let groups = await this.groupRepository.find()
    for (let groupIndex in groups) {      
      let timePeriod = moment.utc().subtract(groups[groupIndex].number_of_weeks, 'weeks')
      let rolls = await this.getStudentRolls(
        timePeriod.format(),
        groups[groupIndex].roll_states,
        groups[groupIndex].ltmt,
        groups[groupIndex].incidents,
      )
      
      const studentsInGroup: GroupStudent[] = map(rolls, roll => {      
        const createGroupStudentInput: CreateGroupStudentInput = {
          student_id: roll.student_id,
          group_id: groups[groupIndex].id,
          incident_count: roll.incident_count,
        }
  
        const groupStudent = new GroupStudent()
        groupStudent.prepareToCreate(createGroupStudentInput)
        return groupStudent
      })
        
      // add the list of students that match the filter to the group
      this.groupStudentRepository.save(studentsInGroup)

      // update the group's metadata
      const group = groups[groupIndex]
      const updateGroupInput: UpdateGroupInput = {
        id: group.id,
        name: group.name,
        number_of_weeks: group.number_of_weeks,
        roll_states: group.roll_states,
        incidents: group.incidents,
        ltmt: group.ltmt,
        run_at: new Date(moment.utc().format()),
        student_count: studentsInGroup.length
      }
      group.prepareToUpdate(updateGroupInput)
      this.groupRepository.save(group)
    }

    return {
      message:"Filters run successfully."
    }    
  }

  async getStudentRolls(timePeriod, rollStates, ltmt, numOfIncidents) {
    return this.studentRollStateRepository
    .createQueryBuilder('student_roll_state')
      .select('COUNT(student_roll_state.id)', 'incident_count')            
      .addSelect('roll_id', 'roll_id')
      .addSelect('student_id', 'student_id')
      .addSelect('state', 'state')    
      .innerJoin(Roll, 'r', 'roll_id = r.id')
      .where('state IN(:...roll_states)', { roll_states: rollStates.split(",") })
      .andWhere('r.completed_at >= :time_period', { time_period: timePeriod })
      .groupBy('student_id')
      .having(`incident_count ${ltmt} :incidents`, { incidents: numOfIncidents })
      .getRawMany()
  }
}
